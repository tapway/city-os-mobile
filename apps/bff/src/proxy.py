"""Reverse proxy: BFF → City Help API with access token injection.

PWA sends `Authorization: Bearer <access_token>` (in-memory). BFF forwards
the same header to City Help. The access token is never persisted server-side.
"""
import logging

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from .settings import settings

logger = logging.getLogger(__name__)
router = APIRouter()

# Headers worth passing through: content negotiation and conditional requests.
# Everything else (cookies, host, x-forwarded-*) is deliberately NOT forwarded.
FORWARDED_HEADERS = ("accept", "accept-language", "if-none-match")

# Cap on buffered request bodies. Evidence images go through /api/uploads, which
# has its own limit, so anything this large here is a mistake or abuse.
MAX_PROXY_BODY_BYTES = 2 * 1024 * 1024

_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    """Shared client so upstream connections are pooled across requests."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
            follow_redirects=False,
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=10),
        )
    return _client


async def close_http_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


@router.api_route("/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def proxy(path: str, request: Request):
    """Forward to City Help API with the access token from the request.

    The PWA sends the Bearer token in the Authorization header (in-memory).
    The BFF strips it from the outgoing request and injects it into the
    upstream call to City Help.
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(401, "Missing Bearer token — please log in")

    # Prepend /api/ since the router strips that prefix — but validate first.
    # httpx normalises "../" *after* the URL is built, so an unchecked path
    # escapes the /api prefix entirely (proven: GET /api/../openapi.json
    # returned the upstream OpenAPI schema with a junk token). Starlette has
    # already percent-decoded the path here, so a decoded ".." is rejected too.
    segments = [s for s in path.split("/") if s]
    if not segments or path.startswith("/") or any(
        s in (".", "..") or any(tok in s.lower() for tok in ("%2e", "%2f", "\\"))
        for s in segments
    ):
        raise HTTPException(400, "Invalid path")

    upstream_url = f"{settings.city_help_api_url}/api/{'/'.join(segments)}"
    if request.url.query:
        upstream_url += f"?{request.url.query}"

    # Forward only the headers City Help needs. Forcing a Content-Type onto a
    # body-less request is what used to make every GET look like a JSON post.
    headers = {"Authorization": auth_header}
    content_type = request.headers.get("Content-Type")
    if content_type:
        headers["Content-Type"] = content_type
    for name in FORWARDED_HEADERS:
        value = request.headers.get(name)
        if value:
            headers[name] = value

    # Read request body
    body = await request.body()
    if len(body) > MAX_PROXY_BODY_BYTES:
        raise HTTPException(413, "Request body is too large for this endpoint")

    client = get_http_client()
    try:
        resp = await client.request(
            method=request.method,
            url=upstream_url,
            headers=headers,
            content=body if body else None,
            timeout=settings.proxy_timeout_seconds,
        )
    except httpx.ConnectError as exc:
        logger.error("BFF proxy: upstream connection failed: %s", exc)
        raise HTTPException(502, "City Help API unreachable")
    except httpx.TimeoutException as exc:
        logger.error("BFF proxy: upstream timeout: %s", exc)
        raise HTTPException(504, "City Help API timed out")
    except httpx.HTTPError as exc:
        logger.error("BFF proxy: upstream error: %s", exc)
        raise HTTPException(502, "City Help API request failed")

    # Return the upstream status and body as-is: 401s must reach the PWA so its
    # refresh-and-retry logic can run, and validation errors keep their detail.
    response_headers = {}
    upstream_type = resp.headers.get("Content-Type")
    if upstream_type:
        response_headers["Content-Type"] = upstream_type
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=response_headers,
    )