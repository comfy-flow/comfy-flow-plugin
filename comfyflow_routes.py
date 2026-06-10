from __future__ import annotations

import asyncio
import json
import secrets
import webbrowser
from typing import Any

from aiohttp import web

from comfyflow_api import (
    fetch_profile,
    get_guide_by_slug,
    get_thread_for_panel,
    get_workflow,
    get_workflow_page,
    increment_download,
    list_guides,
    list_threads,
    list_workflows,
    login_url,
    refresh_session_if_needed,
    update_profile_settings,
)
from comfyflow_config import app_url
from comfyflow_handoff import claim_handoff, claim_handoff_supabase
from comfyflow_session import clear_session, load_session, save_session


def _cors_headers(request: web.Request) -> dict[str, str]:
    origin = request.headers.get("Origin", "")
    allowed_origins = {
        app_url(),
        "https://comfy-flow.com",
        "https://www.comfy-flow.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    }
    headers: dict[str, str] = {}
    if origin in allowed_origins or origin.startswith("http://localhost:"):
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        headers["Access-Control-Allow-Private-Network"] = "true"
        headers["Access-Control-Max-Age"] = "86400"
    return headers


def _with_cors(response: web.Response, request: web.Request) -> web.Response:
    for key, value in _cors_headers(request).items():
        response.headers[key] = value
    return response


def _json(data: Any, *, status: int = 200, request: web.Request | None = None) -> web.Response:
    response = web.json_response(data, status=status)
    if request is not None:
        return _with_cors(response, request)
    return response


async def options_handler(request: web.Request) -> web.Response:
    return _with_cors(web.Response(status=204), request)


async def _parse_session_body(request: web.Request) -> dict[str, Any]:
    content_type = (request.content_type or "").lower()
    if "application/json" in content_type:
        return await request.json()
    post = await request.post()
    return {
        "access_token": post.get("access_token"),
        "refresh_token": post.get("refresh_token"),
        "expires_at": post.get("expires_at"),
        "user_id": post.get("user_id"),
    }


def _session_handoff_html(ok: bool, message: str) -> web.Response:
    title = "ComfyFlow connected" if ok else "ComfyFlow connection failed"
    color = "#10b981" if ok else "#f87171"
    body = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{title}</title></head>
<body style="font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;
align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center;max-width:360px;padding:24px">
<h1 style="color:{color};font-size:1.25rem">{title}</h1>
<p style="color:#9ca3af;line-height:1.5">{message}</p>
</div></body></html>"""
    return web.Response(text=body, content_type="text/html")


async def session_post(request: web.Request) -> web.Response:
    """Browser handoff after login on comfy-flow.com (JSON or form POST)."""
    try:
        body = await _parse_session_body(request)
    except (json.JSONDecodeError, Exception):
        if (request.content_type or "").startswith("application/x-www-form-urlencoded"):
            return _session_handoff_html(False, "Invalid form data.")
        return _json({"ok": False, "error": "invalid body"}, status=400, request=request)

    access_token = body.get("access_token")
    refresh_token = body.get("refresh_token")
    if not access_token or not refresh_token:
        if (request.content_type or "").startswith("application/x-www-form-urlencoded"):
            return _session_handoff_html(False, "Missing sign-in tokens.")
        return _json({"ok": False, "error": "missing tokens"}, status=400, request=request)

    is_form = "application/x-www-form-urlencoded" in (request.content_type or "").lower()

    try:
        expires_raw = body.get("expires_at")
        expires_at: int | None = None
        if expires_raw not in (None, ""):
            try:
                expires_at = int(expires_raw)
            except (TypeError, ValueError):
                expires_at = None

        save_session(
            {
                "access_token": str(access_token),
                "refresh_token": str(refresh_token),
                "expires_at": expires_at,
                "user_id": body.get("user_id"),
            }
        )
        profile = None
        try:
            profile = await fetch_profile(str(access_token))
        except Exception:
            profile = None

        if is_form:
            return _session_handoff_html(
                True,
                "You can close this tab and return to ComfyUI. Open the ComfyFlow panel to browse workflows.",
            )
        return _json({"ok": True, "profile": profile}, request=request)
    except Exception as exc:
        if is_form:
            return _session_handoff_html(False, str(exc))
        return _json({"ok": False, "error": str(exc)}, status=500, request=request)


async def auth_status(request: web.Request) -> web.Response:
    session = load_session()
    if not session or not session.get("access_token"):
        return _json({"logged_in": False}, request=request)

    try:
        session = await refresh_session_if_needed() or session
    except Exception:
        pass

    if not session or not session.get("access_token"):
        return _json({"logged_in": False}, request=request)

    profile = None
    try:
        profile = await fetch_profile(session["access_token"])
    except Exception:
        profile = None

    try:
        site = app_url()
    except Exception:
        site = "https://comfy-flow.com"

    return _json(
        {
            "logged_in": True,
            "profile": profile,
            "app_url": site,
        },
        request=request,
    )


async def auth_login(request: web.Request) -> web.Response:
    port = int(request.rel_url.query.get("port") or _comfyui_port)
    state = secrets.token_urlsafe(24)
    url = login_url(port, state)

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, webbrowser.open, url)

    return _json({"ok": True, "login_url": url, "state": state})


async def auth_poll_handoff(request: web.Request) -> web.Response:
    state = (request.rel_url.query.get("state") or "").strip()
    if not state:
        return _json({"ready": False, "error": "missing state"})
    if claim_handoff(state):
        return _json({"ready": True})
    if await claim_handoff_supabase(state):
        return _json({"ready": True})
    return _json({"ready": False})


async def auth_logout(request: web.Request) -> web.Response:
    clear_session()
    return _json({"ok": True})


async def api_workflows(request: web.Request) -> web.Response:
    search = request.rel_url.query.get("search", "")
    page = int(request.rel_url.query.get("page", "1"))
    limit = min(int(request.rel_url.query.get("limit", "24")), 50)
    try:
        rows = await list_workflows(search=search, page=page, limit=limit)
        items = [
            {
                "id": row["id"],
                "title": row.get("title"),
                "description": row.get("description"),
                "thumbnail_url": row.get("thumbnail_url"),
                "view_count": row.get("view_count"),
                "download_count": row.get("download_count"),
                "clone_count": row.get("clone_count"),
                "rating_avg": row.get("rating_avg"),
                "rating_count": row.get("rating_count"),
                "created_at": row.get("created_at"),
                "is_nsfw": row.get("is_nsfw"),
                "author": row.get("author"),
                "app_url": f"{app_url()}/workflow/{row['id']}",
            }
            for row in rows
        ]
        return _json({"workflows": items, "app_url": app_url()})
    except Exception as exc:
        return _json({"error": str(exc)}, status=500)


async def api_guides(request: web.Request) -> web.Response:
    search = request.rel_url.query.get("search", "")
    difficulty = request.rel_url.query.get("difficulty", "")
    page = int(request.rel_url.query.get("page", "1"))
    limit = min(int(request.rel_url.query.get("limit", "24")), 50)
    try:
        rows = await list_guides(
            search=search,
            difficulty=difficulty,
            page=page,
            limit=limit,
        )
        items = [
            {
                "id": row["id"],
                "title": row.get("title"),
                "slug": row.get("slug"),
                "excerpt": row.get("excerpt"),
                "difficulty": row.get("difficulty"),
                "rating_avg": row.get("rating_avg"),
                "rating_count": row.get("rating_count"),
                "updated_at": row.get("updated_at"),
                "is_nsfw": row.get("is_nsfw"),
                "thumbnail_url": row.get("thumbnail_url"),
                "image_urls": row.get("image_urls") or [],
                "author": row.get("author"),
                "app_url": f"{app_url()}/guides/{row.get('slug')}",
            }
            for row in rows
        ]
        return _json({"guides": items, "app_url": app_url()})
    except Exception as exc:
        return _json({"error": str(exc)}, status=500)


async def api_guide_detail(request: web.Request) -> web.Response:
    slug = request.match_info["slug"]
    try:
        row = await get_guide_by_slug(slug)
        if not row:
            return _json({"error": "not found"}, status=404)
        return _json(
            {
                "id": row["id"],
                "title": row.get("title"),
                "slug": row.get("slug"),
                "excerpt": row.get("excerpt"),
                "body_html": row.get("body_html"),
                "image_urls": row.get("image_urls") or [],
                "difficulty": row.get("difficulty"),
                "rating_avg": row.get("rating_avg"),
                "rating_count": row.get("rating_count"),
                "updated_at": row.get("updated_at"),
                "is_nsfw": row.get("is_nsfw"),
                "author": row.get("author"),
                "linked_workflow_ids": row.get("linked_workflow_ids") or [],
                "linked_workflows": row.get("linked_workflows") or [],
                "app_url": f"{app_url()}/guides/{row.get('slug')}",
            }
        )
    except Exception as exc:
        return _json({"error": str(exc)}, status=500)


async def api_workflow_page(request: web.Request) -> web.Response:
    workflow_id = request.match_info["workflow_id"]
    try:
        row = await get_workflow_page(workflow_id)
        if not row:
            return _json({"error": "not found"}, status=404, request=request)
        return _json(
            {
                "id": row["id"],
                "title": row.get("title"),
                "body_html": row.get("body_html"),
                "preview_urls": row.get("preview_urls") or [],
                "thumbnail_url": row.get("thumbnail_url"),
                "view_count": row.get("view_count"),
                "download_count": row.get("download_count"),
                "clone_count": row.get("clone_count"),
                "rating_avg": row.get("rating_avg"),
                "rating_count": row.get("rating_count"),
                "is_nsfw": row.get("is_nsfw"),
                "author": row.get("author"),
                "app_url": f"{app_url()}/workflow/{row['id']}",
            },
            request=request,
        )
    except Exception as exc:
        return _json({"error": str(exc)}, status=500, request=request)


async def api_threads(request: web.Request) -> web.Response:
    search = request.rel_url.query.get("search", "")
    page = int(request.rel_url.query.get("page", "1"))
    limit = min(int(request.rel_url.query.get("limit", "24")), 50)
    try:
        rows = await list_threads(search=search, page=page, limit=limit)
        items = [
            {
                "id": row["id"],
                "title": row.get("title"),
                "view_count": row.get("view_count"),
                "reply_count": row.get("reply_count"),
                "last_activity_at": row.get("last_activity_at"),
                "created_at": row.get("created_at"),
                "is_pinned": row.get("is_pinned"),
                "is_nsfw": row.get("is_nsfw"),
                "author": row.get("author"),
                "category": row.get("category"),
                "app_url": f"{app_url()}/forum/thread/{row['id']}",
            }
            for row in rows
        ]
        return _json({"threads": items, "app_url": app_url()}, request=request)
    except Exception as exc:
        return _json({"error": str(exc)}, status=500, request=request)


async def api_thread_detail(request: web.Request) -> web.Response:
    thread_id = request.match_info["thread_id"]
    try:
        row = await get_thread_for_panel(thread_id)
        if not row:
            return _json({"error": "not found"}, status=404, request=request)
        return _json(
            {
                "id": row["id"],
                "title": row.get("title"),
                "body_html": row.get("body_html"),
                "view_count": row.get("view_count"),
                "reply_count": row.get("reply_count"),
                "last_activity_at": row.get("last_activity_at"),
                "created_at": row.get("created_at"),
                "is_pinned": row.get("is_pinned"),
                "is_locked": row.get("is_locked"),
                "is_announcement": row.get("is_announcement"),
                "is_nsfw": row.get("is_nsfw"),
                "author": row.get("author"),
                "category": row.get("category"),
                "app_url": f"{app_url()}/forum/thread/{row['id']}",
            },
            request=request,
        )
    except Exception as exc:
        return _json({"error": str(exc)}, status=500, request=request)


async def api_workflow_detail(request: web.Request) -> web.Response:
    workflow_id = request.match_info["workflow_id"]
    try:
        row = await get_workflow(workflow_id)
        if not row:
            return _json({"error": "not found"}, status=404)
        return _json(
            {
                "id": row["id"],
                "title": row.get("title"),
                "workflow_data": row.get("workflow_data"),
            }
        )
    except Exception as exc:
        return _json({"error": str(exc)}, status=500)


async def api_load(request: web.Request) -> web.Response:
    """Queue or return workflow JSON (panel uses direct load; website queues for the JS extension)."""
    global _pending_load_id
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return _json({"error": "invalid json"}, status=400, request=request)

    workflow_id = body.get("workflow_id")
    if not workflow_id:
        return _json({"error": "workflow_id required"}, status=400, request=request)

    queue_only = body.get("queue") is True
    if queue_only:
        _pending_load_id = str(workflow_id)
        return _json({"ok": True, "queued": True}, request=request)

    try:
        row = await get_workflow(workflow_id)
        if not row or row.get("workflow_data") is None:
            return _json({"error": "not found"}, status=404, request=request)
        try:
            await increment_download(workflow_id)
        except Exception:
            pass
        return _json(
            {
                "ok": True,
                "title": row.get("title"),
                "workflow_data": row.get("workflow_data"),
            },
            request=request,
        )
    except Exception as exc:
        return _json({"error": str(exc)}, status=500, request=request)


async def api_settings(request: web.Request) -> web.Response:
    session = load_session()
    if not session or not session.get("access_token"):
        return _json({"error": "unauthorized"}, status=401, request=request)

    try:
        session = await refresh_session_if_needed() or session
    except Exception:
        pass

    try:
        body = await request.json()
    except Exception:
        return _json({"error": "invalid json"}, status=400, request=request)

    show_nsfw = body.get("show_nsfw_content") is True
    hide_nsfw = body.get("hide_nsfw_content") is True

    try:
        profile = await update_profile_settings(
            session["access_token"],
            show_nsfw,
            hide_nsfw,
        )
        return _json(
            {
                "ok": True,
                "profile": profile,
            },
            request=request,
        )
    except Exception as exc:
        return _json({"error": str(exc)}, status=500, request=request)


async def api_poll_load(request: web.Request) -> web.Response:
    """ComfyUI JS polls this to apply workflows queued from the website."""
    global _pending_load_id
    if not _pending_load_id:
        return _json({"pending": False}, request=request)

    workflow_id = _pending_load_id
    _pending_load_id = None
    try:
        row = await get_workflow(workflow_id)
        if not row or row.get("workflow_data") is None:
            return _json({"pending": False, "error": "not found"}, request=request)
        try:
            await increment_download(workflow_id)
        except Exception:
            pass
        return _json(
            {
                "pending": True,
                "id": workflow_id,
                "title": row.get("title"),
                "workflow_data": row.get("workflow_data"),
            },
            request=request,
        )
    except Exception as exc:
        return _json({"pending": False, "error": str(exc)}, request=request)


async def api_object_info(request: web.Request) -> web.Response:
    import aiohttp
    try:
        url = f"http://127.0.0.1:{_comfyui_port}/object_info"
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=5) as resp:
                if resp.status >= 400:
                    return _json({"error": f"ComfyUI returned status {resp.status}"}, status=resp.status, request=request)
                data = await resp.json()
                return _json(data, request=request)
    except Exception as exc:
        return _json({"error": str(exc)}, status=500, request=request)


_comfyui_port = 8188
_pending_load_id: str | None = None


def register_routes(routes: web.RouteTableDef, comfyui_port: int) -> None:
    """Register handlers using ComfyUI's decorator-style RouteTableDef API."""
    global _comfyui_port
    _comfyui_port = comfyui_port

    routes.options("/comfyflow/session")(options_handler)
    routes.post("/comfyflow/session")(session_post)

    routes.options("/comfyflow/auth/status")(options_handler)
    routes.get("/comfyflow/auth/status")(auth_status)
    routes.post("/comfyflow/auth/login")(auth_login)
    routes.get("/comfyflow/auth/poll-handoff")(auth_poll_handoff)
    routes.post("/comfyflow/auth/logout")(auth_logout)

    routes.get("/comfyflow/api/workflows")(api_workflows)
    routes.get("/comfyflow/api/workflows/{workflow_id}/page")(api_workflow_page)
    routes.get("/comfyflow/api/workflows/{workflow_id}")(api_workflow_detail)
    routes.get("/comfyflow/api/guides")(api_guides)
    routes.get("/comfyflow/api/guides/{slug}")(api_guide_detail)
    routes.get("/comfyflow/api/threads")(api_threads)
    routes.get("/comfyflow/api/threads/{thread_id}")(api_thread_detail)

    routes.options("/comfyflow/api/load")(options_handler)
    routes.post("/comfyflow/api/load")(api_load)
    routes.get("/comfyflow/api/poll-load")(api_poll_load)

    routes.options("/comfyflow/api/settings")(options_handler)
    routes.post("/comfyflow/api/settings")(api_settings)

    routes.options("/comfyflow/api/object_info")(options_handler)
    routes.get("/comfyflow/api/object_info")(api_object_info)
