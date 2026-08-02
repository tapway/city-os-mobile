"""Reverse proxy to City Help API."""
from fastapi import APIRouter, HTTPException, Request

router = APIRouter()


@router.api_route("/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def proxy(path: str, request: Request):
    """Forward to City Help API with access token injected."""
    # TODO Task 7
    raise HTTPException(501, "Proxy not implemented — see Task 7")