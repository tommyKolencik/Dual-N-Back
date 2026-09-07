RECALL — Dual N-Back
===================

A full dual N-back training application with a responsive HTML/CSS/JavaScript
frontend and a Flask/Python backend. The server generates both stimulus streams,
scores completed sessions, recommends the next level, and saves recent results in
a local SQLite database.

Run locally
-----------

1. Create or activate a virtual environment:

   python3 -m venv venv
   source venv/bin/activate

2. Install dependencies:

   python -m pip install -r requirements.txt

3. Start the HTML server and Python API:

   python main.py

4. Open http://127.0.0.1:5001 in a browser.

Controls
--------

- Press A (or the Position button) when the square matches N turns back.
- Press L (or the Sound button) when the spoken letter matches N turns back.
- The first N trials are warm-up cues and do not accept responses.
- Pause or press Space to freeze the current response window. Resume continues
  the remaining time without replaying the cue. Switching tabs pauses practice.
- Use Test sound before starting and the volume slider to adjust spoken letters.
- Reset abandons the current attempt; completed results remain in the session log.
- Level, length, pace, and volume preferences are saved in this browser.

Session details
---------------

Each stream includes a balanced selection of repeat targets. Python calculates
accuracy from both correct matches and correct non-matches, excluding warm-up.
History is stored on this server, shared by browsers using this installation.
Sessions are stored in SQLite for 24 hours so a scoring retry or server restart
does not duplicate a completed result. Reloading the page abandons in-page play.
The top summary uses the six most recent completed sessions, not lifetime totals.

The local development server is at http://127.0.0.1:5001. For deployment, use a
Python WSGI host with main:app and a persistent writable path for NBACK_DATABASE.
Flask's debug server should remain for local development only.

Run tests
---------

   python -m unittest discover -s tests
   node --test tests/test_frontend.cjs
