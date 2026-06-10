
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

SESSION_DIR = Path.home() / ".comfyflow"
SESSION_FILE = SESSION_DIR / "plugin-session.json"


def load_session() -> dict[str, Any] | None:
    if not SESSION_FILE.is_file():
        return None
    try:
        data = json.loads(SESSION_FILE.read_text(encoding="utf-8"))
        if data.get("access_token"):
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return None


def save_session(data: dict[str, Any]) -> None:
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    SESSION_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.chmod(SESSION_FILE, 0o600)  # Restrict to owner only
    print(f"[ComfyFlow] Session saved to {SESSION_FILE}")


def clear_session() -> None:
    if SESSION_FILE.is_file():
        SESSION_FILE.unlink(missing_ok=True)
    # Also clear any backup files
    for suffix in (".bak", ".tmp"):
        backup = SESSION_FILE.with_suffix(SESSION_FILE.suffix + suffix)
        if backup.is_file():
            backup.unlink(missing_ok=True)
