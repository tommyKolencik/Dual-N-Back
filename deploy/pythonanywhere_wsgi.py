"""PythonAnywhere WSGI configuration for the tommykolencik account.

Paste this into the WSGI configuration linked from PythonAnywhere's Web tab.
Set the virtualenv to /home/tommykolencik/N-back/.venv and enable Force HTTPS.
This configuration uses the free US-region PythonAnywhere subdomain.
"""

import os
import sys
from pathlib import Path

project_path = Path("/home/tommykolencik/N-back")
data_path = Path("/home/tommykolencik/nback-data")
data_path.mkdir(mode=0o700, parents=True, exist_ok=True)
sys.path.insert(0, str(project_path))

os.environ["NBACK_DATABASE"] = str(data_path / "nback.db")
os.environ["NBACK_COOKIE_SECURE"] = "1"
os.environ["NBACK_PUBLIC_ORIGIN"] = "https://tommykolencik.pythonanywhere.com"
os.environ["NBACK_TRUSTED_HOSTS"] = "tommykolencik.pythonanywhere.com"

from wsgi import application
