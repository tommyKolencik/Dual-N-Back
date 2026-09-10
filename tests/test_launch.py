import hashlib
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from main import create_app
from scripts.backup_db import backup_database


class LaunchReadinessTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = str(Path(self.directory.name) / "test.db")
        self.config = {"TESTING": True, "DATABASE": self.path, "RATE_LIMIT_ENABLED": False}
        self.app = create_app(self.config)
        self.owner = self.app.test_client()
        self.other = self.app.test_client()

    def tearDown(self):
        self.directory.cleanup()

    def create(self, client=None):
        return (client or self.owner).post("/api/sessions", json={}).json

    def finish(self, game, client=None):
        return (client or self.owner).post(f"/api/sessions/{game['session_id']}/complete", json={})

    def test_history_and_completion_are_private_before_and_after_scoring(self):
        game = self.create()
        self.assertEqual(self.finish(game, self.other).status_code, 404)
        self.assertEqual(self.finish(game).status_code, 200)
        self.assertEqual(self.finish(game, self.other).status_code, 404)
        self.assertEqual(self.other.get("/api/history").json["results"], [])
        own_game = self.create(self.other)
        self.assertEqual(self.finish(own_game, self.other).status_code, 200)
        self.assertEqual(self.finish(own_game).status_code, 404)
        for client in (self.owner, self.other):
            self.assertEqual(len(client.get("/api/history").json["results"]), 1)
        with sqlite3.connect(self.path) as database:
            owners = database.execute("SELECT DISTINCT visitor_id FROM results").fetchall()
            self.assertEqual(len(owners), 2)
            token = self.owner.get_cookie("nback_visitor").value
            self.assertIn((hashlib.sha256(token.encode()).hexdigest(),), owners)
            self.assertNotIn((token,), owners)

    def test_malformed_or_missing_cookie_cannot_recover_history(self):
        game = self.create()
        self.finish(game)
        self.owner.delete_cookie("nback_visitor")
        self.assertEqual(self.owner.get("/api/history").json["results"], [])
        for token in ("bad", "../file", "x" * 1000):
            self.owner.set_cookie("nback_visitor", token)
            self.assertEqual(self.owner.get("/api/history").json["results"], [])
            self.assertEqual(self.finish(game).status_code, 404)

    def test_cookie_bootstraps_once_on_page_and_is_not_replaced_by_parallel_apis(self):
        response = self.owner.get("/", base_url="https://localhost")
        cookie = response.headers["Set-Cookie"]
        for flag in ("HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=31536000"):
            self.assertIn(flag, cookie)
        self.assertNotIn("Domain=", cookie)
        response.close()
        token = self.owner.get_cookie("nback_visitor").value
        for endpoint in ("/api/health", "/api/history", "/static/app.js", "/"):
            response = self.owner.get(endpoint, base_url="https://localhost")
            self.assertNotIn("Set-Cookie", response.headers)
            response.close()
        self.assertEqual(token, self.owner.get_cookie("nback_visitor").value)
        for endpoint in ("/api/health", "/api/history"):
            self.assertNotIn("Set-Cookie", self.other.get(endpoint).headers)

    def test_security_headers_and_no_shared_caching(self):
        for endpoint in ("/", "/api/history", "/api/health"):
            response = self.owner.get(endpoint, base_url="https://localhost")
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertEqual(response.headers["X-Frame-Options"], "DENY")
            self.assertIn("script-src 'self'", response.headers["Content-Security-Policy"])
            self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])
            self.assertIn("Strict-Transport-Security", response.headers)
            self.assertNotIn("Access-Control-Allow-Origin", response.headers)
            response.close()

    def test_public_metadata_and_cookie_explanation_match_the_app(self):
        response = self.owner.get("/")
        html = response.get_data(as_text=True)
        self.assertNotIn("RECALL", html)
        self.assertIn('property="og:title" content="Dual N-back"', html)
        self.assertIn('name="twitter:card" content="summary"', html)
        self.assertIn("Privacy &amp; saved progress", html)
        self.assertIn("it does not erase the stored results", html)
        response.close()

    def test_cross_site_requests_rejected_without_database_writes(self):
        for headers in ({"Origin": "https://evil.example"}, {"Origin": "null"},
                        {"Sec-Fetch-Site": "cross-site"}):
            response = self.owner.post("/api/sessions", json={}, headers=headers)
            self.assertEqual(response.status_code, 403)
        with sqlite3.connect(self.path) as database:
            self.assertEqual(database.execute("SELECT count(*) FROM sessions").fetchone()[0], 0)
        self.assertEqual(self.owner.post("/api/sessions", json={}, headers={"Origin": "http://localhost"}).status_code, 200)
        self.assertEqual(self.owner.post("/api/sessions", data="{}", content_type="text/plain").status_code, 400)

    def test_production_origin_cookie_and_trusted_host_configuration(self):
        app = create_app({**self.config, "PUBLIC_ORIGIN": "https://game.example",
                          "VISITOR_COOKIE_SECURE": True, "TRUSTED_HOSTS": ["game.example"]})
        client = app.test_client()
        response = client.post("/api/sessions", json={}, base_url="https://game.example",
                               headers={"Origin": "https://game.example"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("Secure", response.headers["Set-Cookie"])
        self.assertEqual(client.get("/", base_url="https://evil.example").status_code, 400)

    def test_oversized_requests_have_safe_json_errors(self):
        game = self.create()
        for endpoint in ("/api/sessions", f"/api/sessions/{game['session_id']}/complete"):
            response = self.owner.post(endpoint, data="{" + " " * 17000, content_type="application/json")
            self.assertEqual(response.status_code, 413)
            self.assertIn("error", response.json)
        self.assertEqual(self.finish(game).status_code, 200)

    def test_rate_limits_persist_across_workers_ignore_spoofed_ips_and_expire(self):
        config = {**self.config, "RATE_LIMIT_ENABLED": True,
                  "RATE_LIMITS": {"create": (2, 3), "complete": (2, 3), "history": (2, 3)}}
        first = create_app(config).test_client()
        second = create_app(config).test_client()
        with patch("security.time.time", return_value=121):
            for client in (first, second):
                self.assertEqual(client.post("/api/sessions", json={}).status_code, 200)
            second.delete_cookie("nback_visitor")
            blocked = second.post("/api/sessions", json={}, headers={"X-Forwarded-For": "8.8.8.8"})
            self.assertEqual(blocked.status_code, 429)
            self.assertEqual(blocked.headers["Retry-After"], "59")
            self.assertEqual(second.post("/api/sessions", json={}, environ_overrides={"REMOTE_ADDR": "192.0.2.1"}).status_code, 200)
            self.assertEqual(second.post("/api/sessions", json={}, environ_overrides={"REMOTE_ADDR": "192.0.2.2"}).status_code, 429)
        with patch("security.time.time", return_value=181):
            self.assertEqual(second.post("/api/sessions", json={}).status_code, 200)
        with sqlite3.connect(self.path) as database:
            self.assertEqual(database.execute("SELECT count(*) FROM rate_limits WHERE expires_at <= 181").fetchone()[0], 0)

    def test_legacy_records_survive_repeated_migrations_without_becoming_public(self):
        old_path = str(Path(self.directory.name) / "legacy.db")
        with sqlite3.connect(old_path) as database:
            database.execute("CREATE TABLE results (id INTEGER PRIMARY KEY, completed_at TEXT, n_level INTEGER, rounds INTEGER, accuracy REAL, visual_hits INTEGER, visual_targets INTEGER, audio_hits INTEGER, audio_targets INTEGER, false_alarms INTEGER)")
            database.execute("INSERT INTO results VALUES (1, '2026-01-01', 2, 20, 90, 5, 6, 5, 6, 0)")
            database.execute("CREATE TABLE sessions (session_id TEXT PRIMARY KEY, expires_at REAL, data TEXT, result TEXT)")
            database.execute("INSERT INTO sessions VALUES ('legacy', 9999999999, '{}', NULL)")
        for _ in range(2):
            app = create_app({**self.config, "DATABASE": old_path})
            client = app.test_client()
            client.get("/").close()
            self.assertEqual(client.get("/api/history").json["results"], [])
            self.assertEqual(client.post("/api/sessions/legacy/complete", json={}).status_code, 404)
        with sqlite3.connect(old_path) as database:
            self.assertEqual(database.execute("SELECT accuracy, visitor_id FROM results").fetchall(), [(90, None)])
            self.assertEqual(database.execute("SELECT session_id, visitor_id FROM sessions").fetchall(), [("legacy", None)])

    def test_head_history_shares_the_get_rate_limit(self):
        app = create_app({**self.config, "RATE_LIMIT_ENABLED": True,
                          "RATE_LIMITS": {"history": (1, 10)}})
        client = app.test_client()
        self.assertEqual(client.get("/api/history").status_code, 200)
        self.assertEqual(client.head("/api/history").status_code, 429)

    def test_database_failure_is_reported_without_internal_details(self):
        with sqlite3.connect(self.path) as database:
            database.execute("DROP TABLE results")
        with self.assertLogs(self.app.logger, level="ERROR"):
            response = self.owner.get("/api/health")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("results", response.json["error"])
        self.assertNotIn(self.path, response.json["error"])

    def test_backup_is_consistent_private_and_never_overwrites(self):
        self.finish(self.create())
        target = Path(self.directory.name) / "backup.db"
        backup_database(Path(self.path), target)
        with sqlite3.connect(target) as database:
            self.assertEqual(database.execute("SELECT count(*) FROM results").fetchone()[0], 1)
            self.assertEqual(database.execute("PRAGMA quick_check").fetchone()[0], "ok")
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(FileExistsError):
            backup_database(Path(self.path), target)
        with self.assertRaises(FileNotFoundError):
            backup_database(Path(self.directory.name) / "missing.db", Path(self.directory.name) / "empty.db")
        self.assertFalse((Path(self.directory.name) / "empty.db").exists())


if __name__ == "__main__":
    unittest.main()
