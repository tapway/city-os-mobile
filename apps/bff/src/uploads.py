"""Evidence photo uploads for the mobile PWA.

Photos are stored in the City OS object store (MinIO) and referenced on a
ticket by URL, which is the same pattern City Help uses for Jira attachments.

Three routes:
  POST /api/uploads          multipart upload, requires a valid bearer token
  GET    /api/uploads/{key}  stream an object back (used by <img src>)
  DELETE /api/uploads/{key}  remove evidence orphaned by a rejected update

The read route cannot require an Authorization header — browsers do not send
one for image tags — so it is protected by an unguessable object key and by
only ever serving keys under the configured uploads prefix.
"""
from __future__ import annotations

import asyncio

import io
import logging
import re
import uuid
from datetime import date

import httpx
from fastapi import APIRouter, File, Form, Header, HTTPException, Response, UploadFile, Depends

from .ratelimit import rate_limit
from .settings import settings

logger = logging.getLogger(__name__)

router = APIRouter()

EXTENSION_BY_TYPE = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
}

_SAFE_SEGMENT = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_segment(value: str) -> str:
    """Neutralise a user-supplied path segment so it cannot escape the prefix."""
    cleaned = _SAFE_SEGMENT.sub("-", value.strip()).strip(".-")
    return cleaned[:64] or "unassigned"


def _require_bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing Bearer token — please log in")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(401, "Missing Bearer token — please log in")
    return token


async def _verify_token(token: str) -> None:
    """Ask City Help whether this token is real before we store anything.

    Uploads do not pass through the proxy, so without this check any caller
    could fill the object store by inventing a bearer string.
    """
    url = f"{settings.city_help_api_url}/api/v1/auth/me"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError as exc:
        logger.error("Upload auth check failed to reach City Help: %s", exc)
        raise HTTPException(503, "Could not verify your session — please try again")
    if resp.status_code == 401:
        raise HTTPException(401, "Session expired — please sign in again")
    if resp.status_code >= 400:
        # Do not treat an upstream 403/404 as a valid session.
        logger.warning("Upload auth check returned %s: %s", resp.status_code, resp.text[:200])
        raise HTTPException(resp.status_code, "Not allowed to upload evidence")


def _storage():
    from minio import Minio  # imported lazily so a missing dep cannot break startup

    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
    )


@router.post(
    "/api/uploads",
    dependencies=[
        Depends(rate_limit("upload", limit=settings.rate_limit_upload_per_minute, window_seconds=60))
    ],
)
async def upload_evidence(
    file: UploadFile = File(...),
    ticket_uid: str | None = Form(default=None),
    authorization: str | None = Header(default=None),
):
    """Store one evidence photo and return the URL to attach to the ticket."""
    if not settings.uploads_enabled:
        raise HTTPException(503, "Image storage is not configured on this server")

    token = _require_bearer(authorization)
    await _verify_token(token)

    content_type = (file.content_type or "").lower().split(";")[0].strip()
    if content_type not in settings.allowed_upload_types_list:
        raise HTTPException(415, f"Unsupported image type: {content_type or 'unknown'}")

    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty upload")
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            413,
            f"Image is larger than {settings.max_upload_bytes // (1024 * 1024)} MB",
        )

    extension = EXTENSION_BY_TYPE.get(content_type, "jpg")
    day = date.today().strftime("%Y%m%d")
    key = (
        f"{settings.uploads_prefix}/"
        f"{_safe_segment(ticket_uid or 'unassigned')}/{day}/"
        f"{uuid.uuid4().hex}.{extension}"
    )

    try:
        client = _storage()
        bucket = settings.minio_bucket
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)
        client.put_object(
            bucket,
            key,
            io.BytesIO(data),
            length=len(data),
            content_type=content_type,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — surface any storage failure as 503
        logger.error("Evidence upload failed for %s: %s", key, exc)
        raise HTTPException(503, "Could not store the image — please try again")

    return {
        "key": key,
        "url": f"/api/uploads/{key}",
        "size": len(data),
        "content_type": content_type,
    }


@router.delete("/api/uploads/{object_key:path}")
async def delete_evidence(
    object_key: str, authorization: str | None = Header(default=None)
) -> Response:
    """Remove an uploaded object.

    The app uploads evidence *before* the ticket update, so an update the server
    rejects outright leaves an object nothing references. The client deletes it
    here rather than leaving the bucket to accumulate orphans.

    Authenticated and prefix-checked: this is a write, and it must not be usable
    to reach anything outside the uploads prefix.
    """
    token = _require_bearer(authorization)
    await _verify_token(token)

    if not object_key.startswith(f"{settings.uploads_prefix}/"):
        raise HTTPException(400, "Object is not an evidence upload")

    def _remove() -> None:
        client = _storage()
        if client is None:
            return
        try:
            client.remove_object(settings.minio_bucket, object_key)
        except Exception as exc:  # already gone, or storage unavailable
            logger.info("Evidence not deleted (%s): %s", object_key, exc)

    try:
        await asyncio.to_thread(_remove)
    except Exception as exc:
        logger.error("Evidence delete failed for %s: %s", object_key, exc)

    return Response(status_code=204)


@router.get("/api/uploads/{object_key:path}")
async def serve_evidence(object_key: str) -> Response:
    """Stream a stored evidence photo back to the app."""
    if not settings.uploads_enabled:
        raise HTTPException(503, "Image storage is not configured on this server")
    if not object_key.startswith(f"{settings.uploads_prefix}/"):
        # Defence in depth: never serve objects outside our own prefix.
        raise HTTPException(404, "Not found")

    try:
        client = _storage()
        response = client.get_object(settings.minio_bucket, object_key)
        try:
            data = response.read()
        finally:
            response.close()
            response.release_conn()
    except Exception as exc:  # noqa: BLE001
        logger.info("Evidence not served (%s): %s", object_key, exc)
        raise HTTPException(404, "Not found")

    lowered = object_key.lower()
    if lowered.endswith(".png"):
        content_type = "image/png"
    elif lowered.endswith(".webp"):
        content_type = "image/webp"
    elif lowered.endswith(".heic"):
        content_type = "image/heic"
    elif lowered.endswith(".heif"):
        content_type = "image/heif"
    else:
        content_type = "image/jpeg"

    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "private, max-age=3600"},
    )