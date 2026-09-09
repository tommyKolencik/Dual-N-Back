"""Small, database-backed safeguards for an anonymous public game."""

import hashlib
import math
import re
import secrets
import time

from flask import g, jsonify, request


VISITOR_COOKIE = "nback_visitor"
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}\Z")


def register_security(app, get_db):
    @app.before_request
    def protect_request():
        g.visitor_id = None
        token = request.cookies.get(VISITOR_COOKIE, "")
        if TOKEN_PATTERN.fullmatch(token):
            g.visitor_id = hashlib.sha256(token.encode()).hexdigest()

        if request.path.startswith("/api/") and request.method == "POST":
            origin = request.headers.get("Origin")
            expected = app.config["PUBLIC_ORIGIN"] or request.host_url.rstrip("/")
            if (request.headers.get("Sec-Fetch-Site") == "cross-site"
                    or (origin is not None and origin != expected)):
                return jsonify(error="Open the game on this website to continue."), 403
            if not request.is_json:
                return jsonify(error="Send a valid JSON object."), 400
            if (request.content_length is not None
                    and request.content_length > app.config["MAX_CONTENT_LENGTH"]):
                return jsonify(error="This request is too large."), 413

        category = None
        if request.method == "POST" and request.path == "/api/sessions":
            category = "create"
        elif request.method == "POST" and request.endpoint == "complete_session":
            category = "complete"
        elif request.method == "GET" and request.path == "/api/history":
            category = "history"
        if category and app.config["RATE_LIMIT_ENABLED"]:
            retry_after = _rate_limit(app, get_db(), category)
            if retry_after:
                response = jsonify(error="Too many requests. Wait a minute, then try again.")
                response.status_code = 429
                response.headers["Retry-After"] = str(retry_after)
                return response

        # Bootstrap on the page, before its parallel health/history requests.
        # API-only clients can also start a new visitor by creating a game.
        if not g.visitor_id and (request.path == "/" or category == "create"):
            token = secrets.token_urlsafe(32)
            g.visitor_id = hashlib.sha256(token.encode()).hexdigest()
            g.new_visitor_token = token

    @app.after_request
    def protect_response(response):
        if getattr(g, "new_visitor_token", None):
            response.set_cookie(
                VISITOR_COOKIE, g.new_visitor_token, max_age=365 * 24 * 60 * 60,
                secure=app.config["VISITOR_COOKIE_SECURE"] or request.is_secure,
                httponly=True, samesite="Lax", path="/",
            )
        if request.path == "/" or request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
            "base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        )
        if request.is_secure or app.config["VISITOR_COOKIE_SECURE"]:
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        return response

    @app.errorhandler(413)
    def body_too_large(_error):
        return jsonify(error="This request is too large."), 413


def _rate_limit(app, database, category):
    """Fixed-minute network + global limits, shared by all WSGI workers.

    Ignore forwarded IP headers: trusting an arbitrary client header would make
    limits trivial to bypass. A host may normalize REMOTE_ADDR at its boundary.
    Network identifiers are hashed and buckets expire within one minute.
    """
    now = time.time()
    window = int(now // 60)
    expires_at = (window + 1) * 60
    network = hashlib.sha256((request.remote_addr or "unknown").encode()).hexdigest()
    per_network, global_limit = app.config["RATE_LIMITS"][category]
    buckets = ((f"{category}:{window}:{network}", per_network),
               (f"{category}:{window}:global", global_limit))
    with database:
        database.execute("BEGIN IMMEDIATE")
        database.execute("DELETE FROM rate_limits WHERE expires_at <= ?", (now,))
        for key, limit in buckets:
            row = database.execute("SELECT hits FROM rate_limits WHERE bucket = ?", (key,)).fetchone()
            if row is not None and row["hits"] >= limit:
                return max(1, math.ceil(expires_at - now))
        for key, _limit in buckets:
            database.execute(
                "INSERT INTO rate_limits (bucket, expires_at, hits) VALUES (?, ?, 1) "
                "ON CONFLICT(bucket) DO UPDATE SET hits = hits + 1", (key, expires_at),
            )
    return None
