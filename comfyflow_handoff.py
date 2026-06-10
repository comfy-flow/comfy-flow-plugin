from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from comfyflow_session import SESSION_DIR, save_session

HANDOFF_DIR = SESSION_DIR / "handoffs"


def handoff_path(state: str) -> Path:
    safe = "".join(c for c in state if c.isalnum() or c in "-_")
    return HANDOFF_DIR / f"{safe}.json"


def write_handoff_file(state: str, payload: dict[str, Any]) -> Path:
    HANDOFF_DIR.mkdir(parents=True, exist_ok=True)
    path = handoff_path(state)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def read_handoff_file(state: str) -> dict[str, Any] | None:
    path = handoff_path(state)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def delete_handoff_file(state: str) -> None:
    path = handoff_path(state)
    path.unlink(missing_ok=True)


def _apply_handoff_payload(payload: dict[str, Any]) -> bool:
    if not payload.get("access_token"):
        return False
    save_session(
        {
            "access_token": str(payload["access_token"]),
            "refresh_token": str(payload.get("refresh_token") or ""),
            "expires_at": payload.get("expires_at"),
            "user_id": payload.get("user_id"),
        }
    )
    return True


def claim_handoff(state: str) -> bool:
    """Load handoff payload into plugin session file. Returns True if claimed."""
    payload = read_handoff_file(state)
    if not payload:
        return False
    if not _apply_handoff_payload(payload):
        return False
    delete_handoff_file(state)
    return True


async def claim_handoff_supabase(state: str) -> bool:
    from comfyflow_api import _request

    try:
        rows = await _request(
            "GET",
            "plugin_auth_handoffs",
            params={"state": f"eq.{state}", "select": "*"},
        )
        if not isinstance(rows, list) or not rows:
            return False
        row = rows[0]
        if not _apply_handoff_payload(row):
            return False
        await _request(
            "DELETE",
            "plugin_auth_handoffs",
            params={"state": f"eq.{state}"},
        )
        return True
    except Exception as exc:
        print(f"[ComfyFlow] Supabase handoff claim failed: {exc}")
        return False
