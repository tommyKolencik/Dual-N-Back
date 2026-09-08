"""Flask backend for the RECALL dual N-back trainer."""

from __future__ import annotations

import os
import json
import random
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, g, jsonify, request, send_file


BASE_DIR = Path(__file__).resolve().parent
POSITIONS = tuple(range(9))
LETTERS = ("C", "H", "K", "L", "Q", "R", "S", "T")
MATCH_PROBABILITY = 0.28
MAX_N_LEVEL = 20
MIN_SCORED_TRIALS = 7


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__, static_folder="static", static_url_path="/static")
    app.config.from_mapping(
        DATABASE=os.environ.get("NBACK_DATABASE", str(BASE_DIR / "nback.db")),
        JSON_SORT_KEYS=False,
        SESSION_TTL_SECONDS=24 * 60 * 60,
    )
    if test_config:
        app.config.update(test_config)

    def get_db() -> sqlite3.Connection:
        if "db" not in g:
            g.db = sqlite3.connect(app.config["DATABASE"])
            g.db.row_factory = sqlite3.Row
        return g.db

    def init_db() -> None:
        database = get_db()
        database.execute(
            """
            CREATE TABLE IF NOT EXISTS results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                completed_at TEXT NOT NULL,
                n_level INTEGER NOT NULL,
                rounds INTEGER NOT NULL,
                accuracy REAL NOT NULL,
                visual_hits INTEGER NOT NULL,
                visual_targets INTEGER NOT NULL,
                audio_hits INTEGER NOT NULL,
                audio_targets INTEGER NOT NULL,
                false_alarms INTEGER NOT NULL
            )
            """
        )
        database.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                expires_at REAL NOT NULL,
                data TEXT NOT NULL,
                result TEXT
            )
            """
        )
        database.commit()

    @app.teardown_appcontext
    def close_db(_error: BaseException | None) -> None:
        database = g.pop("db", None)
        if database is not None:
            database.close()

    @app.get("/")
    def index():
        return send_file(BASE_DIR / "main.html")

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ready"})

    @app.post("/api/sessions")
    def create_session():
        try:
            payload = _json_object()
            n_level = _bounded_integer(
                payload.get("n_level", 2), "n_level", 1, MAX_N_LEVEL
            )
            rounds = _bounded_integer(payload.get("rounds", 20), "rounds", 12, 40)
            if rounds < n_level + MIN_SCORED_TRIALS:
                raise ValueError(
                    f"rounds must be at least {n_level + MIN_SCORED_TRIALS} "
                    f"for N={n_level}: {n_level} warm-up trials and at least "
                    f"{MIN_SCORED_TRIALS} scored trials."
                )
            interval_ms = _bounded_integer(
                payload.get("interval_ms", 2500), "interval_ms", 1500, 4000
            )
        except ValueError as error:
            return jsonify({"error": str(error)}), 400

        visual = _make_stream(rounds, n_level, POSITIONS)
        audio = _make_stream(rounds, n_level, LETTERS)
        trials = [
            {"position": visual[index], "letter": audio[index]}
            for index in range(rounds)
        ]
        session_id = secrets.token_urlsafe(18)
        session = {
            "n_level": n_level,
            "rounds": rounds,
            "interval_ms": interval_ms,
            "trials": trials,
        }
        database = get_db()
        now = time.time()
        with database:
            database.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
            database.execute(
                "INSERT INTO sessions (session_id, expires_at, data) VALUES (?, ?, ?)",
                (
                    session_id,
                    now + app.config["SESSION_TTL_SECONDS"],
                    json.dumps(session),
                ),
            )
        return jsonify(
            {
                "session_id": session_id,
                "n_level": n_level,
                "rounds": rounds,
                "interval_ms": interval_ms,
                "trials": trials,
            }
        )

    @app.post("/api/sessions/<session_id>/complete")
    def complete_session(session_id: str):
        try:
            payload = _json_object()
        except ValueError as error:
            return jsonify({"error": str(error)}), 400

        database = get_db()
        # Serialize completion across requests/workers. The history entry and
        # cached result commit together, so a retry cannot double-count a round.
        with database:
            database.execute("BEGIN IMMEDIATE")
            row = database.execute(
                "SELECT data, result FROM sessions WHERE session_id = ? AND expires_at > ?",
                (session_id, time.time()),
            ).fetchone()
            if row is None:
                return jsonify({"error": "This session is no longer available."}), 404

            session = json.loads(row["data"])
            try:
                visual_responses = _response_set(
                    payload.get("visual_responses", []), session["rounds"]
                )
                audio_responses = _response_set(
                    payload.get("audio_responses", []), session["rounds"]
                )
            except ValueError as error:
                return jsonify({"error": str(error)}), 400

            if row["result"] is not None:
                return jsonify(json.loads(row["result"]))

            result = _score_session(session, visual_responses, audio_responses)
            database.execute(
                """
                INSERT INTO results (
                    completed_at, n_level, rounds, accuracy,
                    visual_hits, visual_targets, audio_hits, audio_targets,
                    false_alarms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.now(timezone.utc).isoformat(),
                    session["n_level"],
                    session["rounds"],
                    result["accuracy"],
                    result["visual"]["hits"],
                    result["visual"]["targets"],
                    result["audio"]["hits"],
                    result["audio"]["targets"],
                    result["false_alarms"],
                ),
            )
            database.execute(
                "UPDATE sessions SET result = ? WHERE session_id = ?",
                (json.dumps(result), session_id),
            )
        return jsonify(result)

    @app.get("/api/history")
    def history():
        try:
            limit = _bounded_integer(request.args.get("limit", 6), "limit", 1, 20)
        except ValueError as error:
            return jsonify({"error": str(error)}), 400

        rows = get_db().execute(
            """
            SELECT completed_at, n_level, rounds, accuracy,
                   visual_hits, visual_targets, audio_hits, audio_targets,
                   false_alarms
            FROM results
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return jsonify({"results": [dict(row) for row in rows]})

    with app.app_context():
        init_db()

    return app


def _json_object() -> dict:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ValueError("Send a valid JSON object.")
    return payload


def _bounded_integer(value, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError(f"{name} must be a whole number.")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name} must be a whole number.") from error
    if parsed < minimum or parsed > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}.")
    return parsed


def _make_stream(length: int, n_level: int, choices: tuple) -> list:
    """Distribute a balanced number of targets without accidental extra matches."""
    rng = random.SystemRandom()
    eligible = range(n_level, length)
    target_count = min(len(eligible), max(1, round(len(eligible) * MATCH_PROBABILITY)))
    targets = set(rng.sample(eligible, target_count))
    stream = []
    for index in range(length):
        if index in targets:
            stream.append(stream[index - n_level])
            continue

        forbidden = stream[index - n_level] if index >= n_level else None
        candidates = [choice for choice in choices if choice != forbidden]
        stream.append(rng.choice(candidates))
    return stream


def _response_set(values, rounds: int) -> set[int]:
    if not isinstance(values, list):
        raise ValueError("Responses must be sent as a list of trial numbers.")
    responses: set[int] = set()
    for value in values:
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("Every response must be a whole-number trial index.")
        if value < 0 or value >= rounds:
            raise ValueError("A response referred to a trial outside this session.")
        responses.add(value)
    return responses


def _score_channel(values: list, n_level: int, responses: set[int]) -> dict:
    eligible = set(range(n_level, len(values)))
    targets = {
        index
        for index in eligible
        if values[index] == values[index - n_level]
    }
    eligible_responses = responses & eligible
    hits = len(targets & eligible_responses)
    false_alarms = len(eligible_responses - targets)
    misses = len(targets - eligible_responses)
    correct_rejections = len(eligible - targets - eligible_responses)
    return {
        "hits": hits,
        "targets": len(targets),
        "misses": misses,
        "false_alarms": false_alarms,
        "correct_rejections": correct_rejections,
    }


def _score_session(session: dict, visual_responses: set[int], audio_responses: set[int]) -> dict:
    trials = session["trials"]
    n_level = session["n_level"]
    visual = _score_channel(
        [trial["position"] for trial in trials], n_level, visual_responses
    )
    audio = _score_channel(
        [trial["letter"] for trial in trials], n_level, audio_responses
    )
    eligible_decisions = (session["rounds"] - n_level) * 2
    correct_decisions = (
        visual["hits"]
        + visual["correct_rejections"]
        + audio["hits"]
        + audio["correct_rejections"]
    )
    accuracy = round((correct_decisions / eligible_decisions) * 100, 1)
    total_targets = visual["targets"] + audio["targets"]
    total_hits = visual["hits"] + audio["hits"]
    hit_rate = round((total_hits / total_targets) * 100, 1) if total_targets else 100.0
    false_alarms = visual["false_alarms"] + audio["false_alarms"]

    if accuracy >= 82 and hit_rate >= 70 and false_alarms <= 3 and n_level < MAX_N_LEVEL:
        recommendation = {
            "n_level": n_level + 1,
            "message": "You caught most repeats with few extra presses. Try remembering one step further back.",
        }
    elif accuracy < 62 and n_level > 1:
        recommendation = {
            "n_level": n_level - 1,
            "message": "Try one step closer for your next session. Build a steady rhythm before increasing the distance.",
        }
    else:
        recommendation = {
            "n_level": n_level,
            "message": "Repeat this distance. Look for more caught repeats and fewer extra presses.",
        }

    return {
        "accuracy": accuracy,
        "hit_rate": hit_rate,
        "false_alarms": false_alarms,
        "visual": visual,
        "audio": audio,
        "recommendation": recommendation,
    }


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=True)
