"""Private installation settings. Never returned wholesale by HTTP endpoints."""
import json
import os
import pathlib
import tempfile
import threading

PATH = pathlib.Path(__file__).resolve().parent.parent / ".jarvis.local.json"
LOCK = threading.Lock()


def load():
    if PATH.is_symlink():
        raise ValueError("Refusing a symlink for private settings")
    try:
        return json.loads(PATH.read_text())
    except FileNotFoundError:
        return {}


def save(values):
    with LOCK:
        current = load()
        current.update(values)
        fd, name = tempfile.mkstemp(prefix=".jarvis-", dir=PATH.parent)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w") as f:
                json.dump(current, f)
                f.write("\n")
            os.replace(name, PATH)
        finally:
            if os.path.exists(name):
                os.unlink(name)
