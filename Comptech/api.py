import os

# API keys are read from untracked files next to this module (same pattern as
# secret.txt / db_password.txt / salt.txt). Missing files yield an empty key so
# the app still boots; the corresponding calendar sync will simply fail.
_DIR = os.path.dirname(os.path.abspath(__file__))


def _read_key(filename):
    try:
        with open(os.path.join(_DIR, filename)) as f:
            return f.read().strip()
    except FileNotFoundError:
        return ""


GOOGLE_API_KEY = _read_key("google_api_key.txt")
UWATERLOO_API_KEY = _read_key("uwaterloo_api_key.txt")
