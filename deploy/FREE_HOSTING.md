# Free PythonAnywhere deployment

This deployment preserves the Flask/Python backend and SQLite. No paid services
or credit-card charges are configured by these files.

## What is free, and what is not

The Beginner account currently includes one web app, one worker, 512 MiB of disk,
and a provider subdomain. Its web app expires after one month unless you renew it
in the Web dashboard. Choose the free Beginner account, not a paid Developer plan.
Custom domains require a paid PythonAnywhere plan; a `.com` registration is also
separate. Start with `https://YOUR_USERNAME.pythonanywhere.com` at $0.

New free accounts have no scheduled tasks. Backups and monthly renewal therefore
need manual attention. This is a small public hobby deployment, not an uptime
guarantee. Monitor usage and move to a larger host if traffic outgrows the limits.

Official references (checked September 8, 2026):

- [Free account limits](https://help.pythonanywhere.com/pages/FreeAccountsFeatures/)
- [Flask setup](https://help.pythonanywhere.com/pages/Flask/)
- [SQLite availability](https://help.pythonanywhere.com/pages/KindsOfDatabases/)
- [Custom domains](https://help.pythonanywhere.com/pages/CustomDomains)
- [HTTPS](https://help.pythonanywhere.com/pages/HTTPSSetup/)

## 1. Account and source

Create a [Beginner account](https://www.pythonanywhere.com/pricing/).
Upload the prepared release ZIP through the Files tab. In a Bash console, extract
it into a new `/home/YOUR_USERNAME/N-back` directory. The ZIP contains source only,
not your local database, private backups, virtual environment, or Git history.
Do not upload those private files to the public source directory.

If that folder already contains an installation, back up its database and review
the changes before replacing source. Keep production data in the separate
`/home/YOUR_USERNAME/nback-data` directory used by the WSGI configuration.

## 2. Virtual environment

Choose a Python version offered by the host (Python 3.10 or newer). Use the SAME
version in your virtual environment and Web app configuration. For example, if
Python 3.13 is offered:

```sh
cd /home/YOUR_USERNAME/N-back
python3.13 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

## 3. Web app

In the Web tab, choose **Add a new web app → Manual configuration**, then the
matching Python version. Set the virtualenv path to:

```text
/home/YOUR_USERNAME/N-back/.venv
```

Open the WSGI configuration from the Web tab and replace its example app with
the contents of `deploy/pythonanywhere_wsgi.py.example`. Replace every
`YOUR_USERNAME` with your actual username. For EU accounts, change both hostname
and origin to `YOUR_USERNAME.eu.pythonanywhere.com`.

The configuration creates a private persistent data folder, sets Secure cookies,
and restricts accepted hostnames and browser origins. It imports `wsgi:application`
without starting Flask's development server. This host supplies the production
WSGI server, so you do not run `python main.py` or a background Flask console.

Leave static mappings blank for this small initial deployment: Flask serves
`/static/` with the same security headers. Never map `/` to the source folder or
expose the database, backups, or environment files as static content.

Enable **Force HTTPS** in the Web tab, then press **Reload**. PythonAnywhere's
provider subdomain already has an HTTPS certificate. Do not disable secure
cookies to work around an HTTP setup error.

## 4. Verify the public site

- Visit the HTTPS address; `/api/health` should return `{"status":"ready"}`.
- Complete a short session. Refresh: its score should still be visible.
- Open a private/incognito window: the first browser's history must be absent.
- Test sound and the A/L controls on desktop; test the touch buttons and speech
  on an actual phone. Speech availability depends on the browser/device.
- Check light/dark themes, color choice, help, Motivation, and expanded game view.
- Reload the web app in the dashboard; the original browser's history should
  remain available. Source updates must not remove `nback-data`.
- Check error logs if the status indicator is not ready. The free worker can
  queue requests under load; quotas and availability are controlled by the host.

App limits use `REMOTE_ADDR`, never client-provided forwarding headers. Confirm
that the host supplies the intended client address before tuning per-network
limits; otherwise users may share the proxy's allowance. Do not add ProxyFix or
trust X-Forwarded-For blindly.

## 5. Maintenance and backups

Before updates and periodically after play, run the backup command using a new
filename each time (the private `nback-data` folder is created by the WSGI setup):

```sh
cd /home/YOUR_USERNAME/N-back
.venv/bin/python scripts/backup_db.py /home/YOUR_USERNAME/nback-data/nback.db /home/YOUR_USERNAME/nback-data/backup-YYYY-MM-DD.db
```

Download verified backups from the Files tab to your own computer. Keep only the
backups you need within the 512 MiB account allowance; completed scores are not
automatically deleted. Never overwrite or replace the live database during play.

Set your own monthly reminder to renew the free web app in its dashboard. No
scheduled backup or reminder has been created automatically.
