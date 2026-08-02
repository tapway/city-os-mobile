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

    # Build upstream URL — prepend /api/ since the router strips the /api prefix
    upstream_url = f"{settings.city_help_api_url}/api/{path}"
    if request.url.query:
        upstream_url += f"?{request.url.query}"

    # Forward request headers (keep Authorization, Content-Type)
    headers = {
        "Authorization": auth_header,
        "Content-Type": request.headers.get("Content-Type", "application/json"),
    }

    # Read request body
    body = await request.body()

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.request(
                method=request.method,
                url=upstream_url,
                headers=headers,
                content=body,
            )
        except httpx.ConnectError as exc:
            logger.error("BFF proxy: upstream connection failed: %s", exc)
            raise HTTPException(502, "City Help API unreachable")
        except httpx.TimeoutException as exc:
            logger.error("BFF proxy: upstream timeout: %s", exc)
            raise HTTPException(504, "City Help API timed out")
        except Exception as exc:
            logger.error("BFF proxy: upstream error: %s", exc)
            raise HTTPException(502, f"Upstream error: {exc}")

    # Return upstream response as-is
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("Content-Type", "application/json"),
    )