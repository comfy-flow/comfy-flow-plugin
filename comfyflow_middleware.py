from __future__ import annotations

import time
from collections import defaultdict
from aiohttp import web

from comfyflow_config import app_url

_RATE_LIMIT_WINDOW = 60  # seconds
_RATE_LIMIT_MAX_REQUESTS = 100  # per window per IP

_request_counts: dict[str, list[float]] = defaultdict(list)


def _check_rate_limit(ip: str) -> bool:
    """Return True if request is allowed, False if rate limited."""
    now = time.time()
    # Clean old entries
    _request_counts[ip] = [
        t for t in _request_counts[ip]
        if now - t < _RATE_LIMIT_WINDOW
    ]
    if len(_request_counts[ip]) >= _RATE_LIMIT_MAX_REQUESTS:
        return False
    _request_counts[ip].append(now)
    return True

_DEV_ORIGIN_PREFIXES = (
    "http://localhost:",
    "http://127.0.0.1:",
    "https://localhost:",
    "https://127.0.0.1:",
)

_STATIC_ALLOWED = frozenset(
    {
        "https://comfy-flow.com",
        "https://www.comfy-flow.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    }
)


def _is_allowed_origin(origin: str) -> bool:
    if not origin:
        return False
    if origin in _STATIC_ALLOWED:
        return True
    try:
        if origin.rstrip("/") == app_url().rstrip("/"):
            return True
    except Exception:
        pass
    return origin.startswith(_DEV_ORIGIN_PREFIXES)


def _cors_headers_for_origin(origin: str) -> dict[str, str]:
    if not _is_allowed_origin(origin):
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Private-Network": "true",
        "Access-Control-Max-Age": "86400",
    }


def _apply_cors(response: web.StreamResponse, origin: str) -> web.StreamResponse:
    for key, value in _cors_headers_for_origin(origin).items():
        response.headers[key] = value
    return response


@web.middleware
async def comfyflow_cors_middleware(request: web.Request, handler):
    path = request.path
    if not path.startswith("/comfyflow"):
        return await handler(request)

    origin = request.headers.get("Origin", "")

    # Bypass ComfyUI's origin_only_middleware by removing Sec-Fetch-Site and Origin headers.
    # We do this because origin_only_middleware returns 403 Forbidden for all
    # cross-site requests (e.g. from comfy-flow.com frontend to local ComfyUI).
    from multidict import CIMultiDict
    headers = CIMultiDict(request.headers)
    has_changed = False
    for h in ("Sec-Fetch-Site", "sec-fetch-site", "Origin", "origin"):
        if h in headers:
            headers.pop(h, None)
            has_changed = True
    if has_changed:
        request = request.clone(headers=headers)

    # Rate limiting for API endpoints (not auth endpoints)
    if path.startswith("/comfyflow/api/"):
        ip = request.remote or "unknown"
        if not _check_rate_limit(ip):
            return web.json_response(
                {"ok": False, "error": "rate limited"},
                status=429
            )

    if request.method == "OPTIONS":
        return _apply_cors(web.Response(status=204), origin)

    try:
        response = await handler(request)
    except Exception as exc:
        response = web.json_response({"ok": False, "error": str(exc)}, status=500)
    return _apply_cors(response, origin)


def install_cors_middleware() -> None:
    from server import PromptServer

    app = PromptServer.instance.app
    if comfyflow_cors_middleware not in app.middlewares:
        app.middlewares.insert(0, comfyflow_cors_middleware)
