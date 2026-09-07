import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

from main import _score_channel, create_app


class NBackAppTests(unittest.TestCase):
    def setUp(self):
        database = tempfile.NamedTemporaryFile(delete=False)
        database.close()
        self.database_path = database.name
        self.app = create_app({"TESTING": True, "DATABASE": self.database_path})
        self.client = self.app.test_client()

    def tearDown(self):
        os.unlink(self.database_path)

    def test_home_and_health_are_served(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "text/html")
        self.assertIn(b"<html", response.data)
        response.close()
        self.assertEqual(self.client.get("/api/health").json, {"status": "ready"})

    def test_session_can_be_created_and_completed(self):
        created = self.client.post(
            "/api/sessions",
            json={"n_level": 2, "rounds": 12, "interval_ms": 2500},
        )
        self.assertEqual(created.status_code, 200)
        session = created.json
        self.assertEqual(len(session["trials"]), 12)

        completed = self.client.post(
            f"/api/sessions/{session['session_id']}/complete",
            json={"visual_responses": [], "audio_responses": []},
        )
        self.assertEqual(completed.status_code, 200)
        self.assertIn("accuracy", completed.json)
        self.assertIn("recommendation", completed.json)

        history = self.client.get("/api/history").json["results"]
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["n_level"], 2)

    def test_invalid_configuration_is_rejected(self):
        for field, value in (
            ("n_level", 9),
            ("n_level", 2.5),
            ("n_level", True),
            ("n_level", None),
            ("n_level", {}),
            ("rounds", 12.8),
            ("interval_ms", float("inf")),
            ("interval_ms", "2500.5"),
        ):
            with self.subTest(field=field, value=value):
                response = self.client.post("/api/sessions", json={field: value})
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json["error"])

    def test_malformed_json_is_rejected_by_both_endpoints(self):
        session = self.client.post("/api/sessions", json={}).json
        endpoints = (
            "/api/sessions",
            f"/api/sessions/{session['session_id']}/complete",
        )
        for endpoint in endpoints:
            for body in ("[]", '["unexpected"]', "null", "true", '"text"', "{", ""):
                with self.subTest(endpoint=endpoint, body=body):
                    response = self.client.post(
                        endpoint, data=body, content_type="application/json"
                    )
                    self.assertEqual(response.status_code, 400)
                    self.assertIn("error", response.json)

    def test_invalid_responses_do_not_consume_the_session(self):
        session = self.client.post("/api/sessions", json={}).json
        endpoint = f"/api/sessions/{session['session_id']}/complete"
        for value in (None, "1", [True], [1.5], ["1"], [-1], [20]):
            with self.subTest(value=value):
                response = self.client.post(endpoint, json={"visual_responses": value})
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.post(endpoint, json={}).status_code, 200)
        self.assertEqual(len(self.client.get("/api/history").json["results"]), 1)

    def test_perfect_responses_score_both_channels_and_ignore_warmup(self):
        session = self.client.post(
            "/api/sessions", json={"n_level": 3, "rounds": 12}
        ).json
        trials = session["trials"]
        responses = {}
        for channel, key in (("visual", "position"), ("audio", "letter")):
            targets = [
                index
                for index in range(3, len(trials))
                if trials[index][key] == trials[index - 3][key]
            ]
            self.assertGreater(len(targets), 0)
            self.assertLess(len(targets), len(trials) - 3)
            responses[f"{channel}_responses"] = [0, 1, 2] + targets + targets

        result = self.client.post(
            f"/api/sessions/{session['session_id']}/complete", json=responses
        ).json
        self.assertEqual(result["accuracy"], 100.0)
        self.assertEqual(result["hit_rate"], 100.0)
        self.assertEqual(result["false_alarms"], 0)
        self.assertEqual(result["recommendation"]["n_level"], 4)
        for channel in ("visual", "audio"):
            self.assertEqual(result[channel]["hits"], result[channel]["targets"])
            self.assertEqual(result[channel]["misses"], 0)

    def test_channel_distinguishes_misses_false_alarms_and_correct_rejections(self):
        result = _score_channel([0, 1, 0, 2, 0, 3], 2, {0, 1, 2, 3})
        self.assertEqual(
            result,
            {"hits": 1, "targets": 2, "misses": 1, "false_alarms": 1,
             "correct_rejections": 1},
        )

    def test_short_sessions_at_every_level_have_targets_and_non_targets(self):
        for n_level in range(1, 6):
            with self.subTest(n_level=n_level):
                session = self.client.post(
                    "/api/sessions", json={"n_level": n_level, "rounds": 12}
                ).json
                trials = session["trials"]
                for key in ("position", "letter"):
                    targets = sum(
                        trials[index][key] == trials[index - n_level][key]
                        for index in range(n_level, 12)
                    )
                    self.assertGreaterEqual(targets, 2)
                    self.assertLess(targets, 12 - n_level)

    def test_completion_survives_restart_and_retries_do_not_duplicate_history(self):
        session = self.client.post("/api/sessions", json={}).json
        endpoint = f"/api/sessions/{session['session_id']}/complete"
        restarted = create_app({"TESTING": True, "DATABASE": self.database_path})
        client = restarted.test_client()
        first = client.post(endpoint, json={})
        self.assertEqual(first.status_code, 200)

        restarted_again = create_app({"TESTING": True, "DATABASE": self.database_path})
        client = restarted_again.test_client()
        retry = client.post(endpoint, json={"visual_responses": [2, 3]})
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json, first.json)
        self.assertEqual(len(client.get("/api/history").json["results"]), 1)

    def test_concurrent_completion_is_saved_only_once(self):
        session = self.client.post("/api/sessions", json={}).json
        endpoint = f"/api/sessions/{session['session_id']}/complete"

        def complete(_index):
            with self.app.test_client() as client:
                response = client.post(endpoint, json={})
                return response.status_code, response.json

        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(complete, range(4)))
        self.assertTrue(all(status == 200 for status, _result in results))
        self.assertTrue(all(result == results[0][1] for _status, result in results))
        self.assertEqual(len(self.client.get("/api/history").json["results"]), 1)

    def test_unknown_session_and_invalid_history_limit(self):
        self.assertEqual(
            self.client.post("/api/sessions/missing/complete", json={}).status_code, 404
        )
        self.assertEqual(self.client.get("/api/history?limit=2.5").status_code, 400)
        self.assertEqual(self.client.get("/api/history?limit=21").status_code, 400)
        self.assertEqual(self.client.get("/api/history?limit=2").status_code, 200)


if __name__ == "__main__":
    unittest.main()
