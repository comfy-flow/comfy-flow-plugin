"""Supabase REST helpers for the ComfyUI plugin."""

from __future__ import annotations

import json
import re
import time
from typing import Any
from urllib.parse import urlencode

_WORKFLOW_ID_IN_HTML = re.compile(
    r"(?:/workflow/|workflow_id[=:\"']+)"
    r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
    re.IGNORECASE,
)

_WORKFLOW_UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE,
)


import aiohttp

from comfyflow_config import app_url, supabase_anon_key, supabase_url
from comfyflow_session import clear_session, load_session, save_session


def _validate_workflow_id(workflow_id: str) -> str:
    """Validate and return workflow_id as lowercase UUID string."""
    if not workflow_id or not isinstance(workflow_id, str):
        raise ValueError("workflow_id must be a non-empty string")

    normalized = workflow_id.strip().lower()
    if not _WORKFLOW_UUID_RE.match(normalized):
        raise ValueError(f"Invalid workflow_id format: {workflow_id}")

    return normalized


def _auth_headers(access_token: str | None = None) -> dict[str, str]:
    token = access_token or (load_session() or {}).get("access_token") or supabase_anon_key()
    return {
        "apikey": supabase_anon_key(),
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


async def _request(
    method: str,
    path: str,
    *,
    params: dict[str, str] | None = None,
    json_body: Any = None,
    access_token: str | None = None,
) -> Any:
    base = f"{supabase_url()}/rest/v1/{path.lstrip('/')}"
    if params:
        base = f"{base}?{urlencode(params)}"

    headers = _auth_headers(access_token)
    async with aiohttp.ClientSession() as session:
        async with session.request(
            method,
            base,
            headers=headers,
            json=json_body,
        ) as resp:
            text = await resp.text()
            if resp.status >= 400:
                raise RuntimeError(f"Supabase error {resp.status}: {text[:300]}")
            if not text:
                return None
            return json.loads(text)


async def refresh_session_if_needed() -> dict[str, Any] | None:
    session = load_session()
    if not session or not session.get("refresh_token"):
        return session

    # Check if token is expired based on expires_at
    expires_at = session.get("expires_at")
    if expires_at:
        # Add 60 second buffer before actual expiry
        if time.time() < (expires_at - 60):
            return session  # Token still valid with buffer

    try:
        url = f"{supabase_url()}/auth/v1/token?grant_type=refresh_token"
        headers = {
            "apikey": supabase_anon_key(),
            "Content-Type": "application/json",
        }
        body = {"refresh_token": session["refresh_token"]}
    except Exception:
        # Config not loaded — keep saved session so login still works
        return session

    try:
        async with aiohttp.ClientSession() as http:
            async with http.post(url, headers=headers, json=body) as resp:
                if resp.status == 401:
                    clear_session()
                    return None
                if resp.status >= 400:
                    return session
                data = await resp.json()
    except Exception:
        return session

    updated = {
        **session,
        "access_token": data.get("access_token") or session.get("access_token"),
        "refresh_token": data.get("refresh_token", session.get("refresh_token")),
        "expires_at": data.get("expires_at", session.get("expires_at")),
    }
    save_session(updated)
    return updated


async def fetch_profile(access_token: str) -> dict[str, Any] | None:
    user_id = await get_auth_user_id(access_token)
    if not user_id:
        return None
    rows = await _request(
        "GET",
        "profiles",
        params={
            "user_id": f"eq.{user_id}",
            "select": "id,username,avatar_url,show_nsfw_content,hide_nsfw_content",
        },
        access_token=access_token,
    )
    if isinstance(rows, list) and rows:
        return rows[0]
    return None


async def update_profile_settings(
    access_token: str,
    show_nsfw_content: bool,
    hide_nsfw_content: bool,
) -> dict[str, Any] | None:
    user_id = await get_auth_user_id(access_token)
    if not user_id:
        return None
    rows = await _request(
        "PATCH",
        "profiles",
        params={
            "user_id": f"eq.{user_id}",
            "select": "id,username,avatar_url,show_nsfw_content,hide_nsfw_content",
        },
        json_body={
            "show_nsfw_content": show_nsfw_content,
            "hide_nsfw_content": hide_nsfw_content,
        },
        access_token=access_token,
    )
    if isinstance(rows, list) and rows:
        return rows[0]
    return None


async def get_auth_user_id(access_token: str) -> str | None:
    url = f"{supabase_url()}/auth/v1/user"
    headers = {
        "apikey": supabase_anon_key(),
        "Authorization": f"Bearer {access_token}",
    }
    async with aiohttp.ClientSession() as session:
        async with session.get(url, headers=headers) as resp:
            if resp.status >= 400:
                return None
            data = await resp.json()
            return data.get("id")


async def list_workflows(
    *,
    search: str = "",
    page: int = 1,
    limit: int = 24,
) -> list[dict[str, Any]]:
    session = await refresh_session_if_needed()
    token = (session or {}).get("access_token")

    matching_ids: list[str] | None = None
    trimmed = search.strip()
    if trimmed:
        ids = await _request(
            "POST",
            "rpc/workflow_ids_matching_search",
            json_body={"p_term": trimmed},
            access_token=token,
        )
        matching_ids = [row["id"] for row in (ids or [])]
        if not matching_ids:
            return []

    offset = (max(page, 1) - 1) * limit
    params: dict[str, str] = {
        "select": (
            "id,title,description,thumbnail_url,view_count,download_count,clone_count,"
            "rating_avg,rating_count,created_at,is_nsfw,author:profiles!profile_id(username,avatar_url)"
        ),
        "is_public": "eq.true",
        "status": "eq.published",
        "order": "created_at.desc",
        "limit": str(limit),
        "offset": str(offset),
    }
    if matching_ids is not None:
        params["id"] = f"in.({','.join(matching_ids)})"

    rows = await _request("GET", "workflows", params=params, access_token=token)
    return rows if isinstance(rows, list) else []


async def get_workflow(workflow_id: str) -> dict[str, Any] | None:
    try:
        validated_id = _validate_workflow_id(workflow_id)
    except ValueError:
        return None  # Return None for invalid IDs instead of error

    session = await refresh_session_if_needed()
    token = (session or {}).get("access_token")

    params = {
        "id": f"eq.{validated_id}",
        "select": "id,title,workflow_data,status,is_public",
    }
    rows = await _request("GET", "workflows", params=params, access_token=token)
    if not isinstance(rows, list) or not rows:
        return None
    row = rows[0]
    if row.get("status") != "published" or not row.get("is_public"):
        return None
    return row


async def get_workflow_page(workflow_id: str) -> dict[str, Any] | None:
    """Public workflow metadata + sanitized description HTML for the panel (no graph JSON)."""
    session = await refresh_session_if_needed()
    token = (session or {}).get("access_token")

    params = {
        "id": f"eq.{workflow_id}",
        "select": (
            "id,title,description,view_count,download_count,clone_count,rating_avg,rating_count,"
            "thumbnail_url,preview_urls,is_nsfw,author:profiles!profile_id(username,avatar_url)"
        ),
        "status": "eq.published",
        "is_public": "eq.true",
    }
    rows = await _request("GET", "workflows", params=params, access_token=token)
    if not isinstance(rows, list) or not rows:
        return None
    row = rows[0]
    desc = row.get("description") or ""
    row["body_html"] = sanitize_guide_html(str(desc))
    return row


def sanitize_guide_html(html: str) -> str:
    """Strip scripts and event handlers before sending guide HTML to the ComfyUI panel."""
    if not html:
        return ""
    cleaned = re.sub(r"<script[\s\S]*?</script>", "", html, flags=re.IGNORECASE)
    cleaned = re.sub(r"<style[\s\S]*?</style>", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(
        r"\s+on\w+\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+)",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"javascript:", "", cleaned, flags=re.IGNORECASE)
    return cleaned[:120_000]


def extract_workflow_ids_from_html(html: str) -> list[str]:
    if not html:
        return []
    return list(dict.fromkeys(_WORKFLOW_ID_IN_HTML.findall(html)))


async def list_guides(
    *,
    search: str = "",
    difficulty: str = "",
    page: int = 1,
    limit: int = 24,
) -> list[dict[str, Any]]:
    session = await refresh_session_if_needed()
    token = (session or {}).get("access_token")

    offset = (max(page, 1) - 1) * limit
    params: dict[str, str] = {
        "select": (
            "id,title,slug,excerpt,difficulty,rating_avg,rating_count,updated_at,"
            "is_nsfw,image_urls,author:profiles!profile_id(username,avatar_url)"
        ),
        "status": "eq.published",
        "is_public": "eq.true",
        "order": "updated_at.desc",
        "limit": str(limit),
        "offset": str(offset),
    }
    trimmed = search.strip()
    if trimmed:
        params["title"] = f"ilike.%{trimmed}%"
    if difficulty and difficulty not in ("all", ""):
        params["difficulty"] = f"eq.{difficulty}"

    rows = await _request("GET", "guides", params=params, access_token=token)
    return rows if isinstance(rows, list) else []


async def list_threads(
    *,
    search: str = "",
    page: int = 1,
    limit: int = 24,
) -> list[dict[str, Any]]:
    session = await refresh_session_if_needed()
    token = (session or {}).get("access_token")

    offset = (max(page, 1) - 1) * limit
    params: dict[str, str] = {
        "select": (
            "id,title,view_count,reply_count,last_activity_at,created_at,is_pinned,is_nsfw,"
            "author:profiles!forum_threads_user_id_fkey(username,avatar_url),"
            "category:workflow_categories!forum_threads_category_id_fkey(name,slug)"
        ),
        "is_archived": "eq.false",
        "order": "last_activity_at.desc",
        "limit": str(limit),
        "offset": str(offset),
    }
    trimmed = search.strip()
    if trimmed:
        params["title"] = f"ilike.%{trimmed}%"

    rows = await _request("GET", "forum_threads", params=params, access_token=token)
    return rows if isinstance(rows, list) else []


async def get_thread_for_panel(thread_id: str) -> dict[str, Any] | None:
    """Thread row + opening post HTML (sanitized) for the panel. Does not bump view_count."""
    session = await refresh_session_if_needed()
    token = (session or {}).get("access_token")

    tparams = {
        "id": f"eq.{thread_id}",
        "select": (
            "id,title,view_count,reply_count,last_activity_at,created_at,is_pinned,is_locked,"
            "is_announcement,is_nsfw,image_urls,author:profiles!forum_threads_user_id_fkey(username,avatar_url),"
            "category:workflow_categories!forum_threads_category_id_fkey(name,slug)"
        ),
        "is_archived": "eq.false",
    }
    trows = await _request("GET", "forum_threads", params=tparams, access_token=token)
    if not isinstance(trows, list) or not trows:
        return None
    row = dict(trows[0])

    pparams = {
        "thread_id": f"eq.{thread_id}",
        "is_deleted": "eq.false",
        "select": "content",
        "order": "created_at.asc",
        "limit": "1",
    }
    posts = await _request("GET", "forum_posts", params=pparams, access_token=token)
    op_html = ""
    if isinstance(posts, list) and posts:
        op_html = sanitize_guide_html(str(posts[0].get("content") or ""))
    row["body_html"] = op_html
    return row


async def fetch_linked_workflow_summaries(
    workflow_ids: list[str],
    *,
    access_token: str | None = None,
) -> list[dict[str, str]]:
    """Published public workflows referenced in a guide (id + title), order preserved."""
    if not workflow_ids:
        return []
    ordered_unique = list(dict.fromkeys(workflow_ids))
    params: dict[str, str] = {
        "id": f"in.({','.join(ordered_unique)})",
        "select": "id,title",
        "status": "eq.published",
        "is_public": "eq.true",
    }
    try:
        rows = await _request("GET", "workflows", params=params, access_token=access_token)
    except Exception:
        rows = []
    titles: dict[str, str] = {}
    if isinstance(rows, list):
        for r in rows:
            rid = r.get("id")
            if rid:
                titles[str(rid)] = str(r.get("title") or "Untitled")
    return [
        {
            "id": wid,
            "title": titles.get(wid, f"Workflow {wid[:8]}…"),
        }
        for wid in ordered_unique
    ]


async def get_guide_by_slug(slug: str) -> dict[str, Any] | None:
    session = await refresh_session_if_needed()
    token = (session or {}).get("access_token")

    params = {
        "slug": f"eq.{slug}",
        "select": (
            "id,title,slug,excerpt,body_html,image_urls,difficulty,rating_avg,rating_count,"
            "updated_at,is_nsfw,status,is_public,"
            "author:profiles!profile_id(username,avatar_url)"
        ),
        "status": "eq.published",
        "is_public": "eq.true",
    }
    rows = await _request("GET", "guides", params=params, access_token=token)
    if not isinstance(rows, list) or not rows:
        return None
    row = rows[0]
    body = row.get("body_html") or ""
    row["body_html"] = sanitize_guide_html(body)
    linked_ids = extract_workflow_ids_from_html(body)
    row["linked_workflow_ids"] = linked_ids
    row["linked_workflows"] = await fetch_linked_workflow_summaries(
        linked_ids,
        access_token=token,
    )
    return row


async def increment_download(workflow_id: str) -> None:
    session = await refresh_session_if_needed()
    token = (session or {}).get("access_token")
    await _request(
        "POST",
        "rpc/increment_workflow_download_count",
        json_body={"p_workflow_id": workflow_id},
        access_token=token,
    )


def login_url(comfyui_port: int, state: str) -> str:
    return f"{app_url()}/auth/plugin?port={comfyui_port}&state={state}"
