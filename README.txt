Dual N-Back
Author: Tommy Kolencik
Last Updated: Sept 8, 2026
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
- Memory distance supports 1-back through 20-back. Shorter session lengths are
  disabled when they would leave fewer than seven scored trials after warm-up;
  the app automatically selects the next valid length. At 20-back, choose 30 or
  40 total trials (20 warm-up cues plus 10 or 20 scored trials).
- Pause or press Space to freeze the current response window. Resume continues
  the remaining time without replaying the cue. Switching tabs pauses practice.
- Use Test sound before starting and the volume slider to adjust spoken letters.
- Reset abandons the current attempt; completed results remain in the session log.
- Level, length, pace, and volume preferences are saved in this browser.
- Appearance in the header lets you choose light or dark mode and a preset or
  custom accent color (color picker or hex value). Changes are saved separately
  from training preferences. Text and cues adjust for contrast; right/wrong
  feedback retains its green/red meaning. Opening Appearance pauses practice.
- The Dual N-back title uses the complementary hue of the chosen accent, with
  contrast adjusted for the active theme. Sentence-ending periods and the footer
  heart use accent colors; wording, email addresses, and decimal values are intact.
- Match buttons show Right or Wrong immediately. The previous-cue row shows each
  channel's correct match, wrong match, missed match, or correct pass once the
  response window ends. Warm-up cues are not scored; feedback does not play sound.
- How to play includes The rules and Simple example tabs. The example walks
  through three untimed 2-back cues with optional spoken letters and practice
  buttons. It pauses an active session and never changes the session score.
- Game size adjusts the board from 80% to 150%. Expand hides the side controls;
  Full screen uses browser full screen when supported and falls back to Expand
  otherwise. Start, pause/resume, and reset also live inside the game panel.
  Changing the view pauses an active game; resume explicitly when ready.
- Tips & Notes is collapsible. Motivation includes the author's story and four
  credited academic papers, with short findings and limitations. Research links
  open in a new tab, so the game stays available. These papers did not test this app.
- The footer's Github and email controls share the selected accent color. Email
  copies thomas.w.kolencik@gmail.com without opening a mail app; if clipboard
  access is unavailable, a selected text field allows manual copying.

Session details
---------------

Each stream includes a balanced selection of repeat targets. Python calculates
accuracy from both correct matches and correct non-matches, excluding warm-up.
History is stored on this server and isolated by a random, host-only browser
cookie (HttpOnly, SameSite=Lax; Secure over HTTPS). The database stores only a hash
of that cookie. There are no accounts or cross-device synchronization. Clearing
the cookie or letting it expire after one year loses access to that history;
it does not delete the stored scores. Do not share browser profiles for private
history. Backups also contain scores and should be kept private.

Old shared records are preserved by the schema migration with no assigned
visitor. They are intentionally not shown to anyone and cannot be claimed via
the public API. The migration is transactional and safe to run again.
Sessions are stored in SQLite for 24 hours so a scoring retry or server restart
does not duplicate a completed result. Reloading the page abandons in-page play.
The top summary uses the six most recent completed sessions, not lifetime totals.

The local development server is at http://127.0.0.1:5001. Debugging is off by
default. Production uses wsgi:application (or main:app), never python main.py.

Free hosting
------------

See deploy/FREE_HOSTING.md for the PythonAnywhere Beginner setup. This keeps the
Python backend and SQLite on persistent storage without a hosting subscription.
The free address is YOUR_USERNAME.pythonanywhere.com (or the EU equivalent).
PythonAnywhere requires a paid plan for custom domains, and domain registration
is a separate cost. The free web app must be renewed manually each month.

The host's managed WSGI server runs the app; no Gunicorn dependency is required
for PythonAnywhere. Use the supplied configuration example, private data path,
exact allowed hostname/origin, Secure cookies and the dashboard's Force HTTPS.

Public-server safeguards
-----------------------

- POST bodies are limited to 16 KiB; cross-site writes and non-JSON submissions
  are rejected. Personal page/API responses are not cached.
- Browser security headers restrict script sources and prevent framing. Inline
  styles remain allowed for the existing theme and board-size controls.
- SQLite-backed fixed-minute limits apply across workers and restarts. Defaults
  are 30 new sessions, 90 completion requests, and 120 history requests per
  network per minute, with global limits ten times those values. They return
  JSON 429 plus Retry-After. These are basic safeguards, not DDoS protection.
- Forwarded IP headers are not trusted by the app. A hosting proxy must provide
  a trustworthy REMOTE_ADDR; otherwise visitors behind that proxy share a limit.
  Limits use short-lived hashed network identifiers. The hosting provider may
  retain separate access logs; review its privacy policy before public launch.
- Expired game sessions and rate-limit buckets are cleaned during requests.
  Completed scores are retained; monitor the free account's disk usage.
- /api/health checks database access. Database failures return a safe 503 error
  without exposing internal paths or queries.

Backups
-------

Run this with the virtual environment active; choose a NEW destination filename:

   python scripts/backup_db.py /private/path/nback.db /private/path/backup-YYYY-MM-DD.db

It uses SQLite's online backup API, checks the backup, gives it owner-only file
permissions and refuses to overwrite existing files. Download a copy off the
hosting account. Keep all database files outside static/ and the public web root.
New free PythonAnywhere accounts do not include scheduled tasks, so backups and
monthly renewals are manual unless you separately arrange an external scheduler.
Create a backup before updates or migrations. To restore: stop the web app,
preserve the current database, point NBACK_DATABASE at a verified restored copy,
then reload and check /api/health. Do not overwrite a database while it is live.

Run tests
---------

   python -m unittest discover -s tests
   node --test tests/test_frontend.cjs
   node --test tests/test_tutorial.cjs
   node --test tests/test_appearance.cjs
   node --test tests/test_workspace.cjs
   node --test tests/test_typography.cjs
