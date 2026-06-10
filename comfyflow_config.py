from __future__ import annotations

import hashlib
import hmac
import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

_PACKAGE_DIR = Path(__file__).resolve().parent
_LOCAL_CONFIG = _PACKAGE_DIR / "config.json"
_DEFAULT_REMOTE = "https://comfy-flow.com/comfyflow-plugin.json"
# NOTE: For initial deployment, local config.json is more secure than remote fetch.
# Only use remote fetch as fallback with known-good HTTPS endpoints and signature verification enabled.

_cache: dict[str, Any] | None = None
_config_signature: str | None = None  # Set during development/secure deployment


def _verify_signature(data: bytes, signature: str, secret: str) -> bool:
    """Verify HMAC-SHA256 signature of config data."""
    expected = hmac.new(
        secret.encode(),
        data,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def _fetch_remote(url: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read()

    # If a signature header is provided, verify it
    signature = resp.headers.get("X-Config-Signature", "")
    if signature and _config_signature:
        if not _verify_signature(raw, signature, _config_signature):
            raise RuntimeError("Config signature verification failed!")

    return json.loads(raw)


def get_config() -> dict[str, Any]:
    global _cache
    if _cache is not None:
        return _cache

    if _LOCAL_CONFIG.is_file():
        data = json.loads(_LOCAL_CONFIG.read_text(encoding="utf-8"))
        if data.get("supabaseUrl") and data.get("supabaseAnonKey"):
            _cache = data
            return _cache

    fallbacks = (
        _DEFAULT_REMOTE,
        "http://127.0.0.1:3000/comfyflow-plugin.json",
        "http://localhost:3000/comfyflow-plugin.json",
    )
    last_error: Exception | None = None
    for url in fallbacks:
        try:
            _cache = _fetch_remote(url)
            if _cache.get("supabaseUrl") and _cache.get("supabaseAnonKey"):
                return _cache
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            continue

    raise RuntimeError(
        "Could not load ComfyFlow settings. Check your internet connection "
        f"or place config.json in {_PACKAGE_DIR}"
    ) from last_error


def app_url() -> str:
    return str(get_config().get("appUrl") or "https://comfy-flow.com").rstrip("/")


def supabase_url() -> str:
    return str(get_config()["supabaseUrl"]).rstrip("/")


def supabase_anon_key() -> str:
    return str(get_config()["supabaseAnonKey"])
