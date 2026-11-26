"""A small in-memory rate limiter for the BFF's unauthenticated endpoints.

`/auth/login`, `/auth/refresh` and `/api/uploads` are reachable without a session
and each does real work upstream (a Keycloak round trip, or an object-store
write), so they are the ones worth bounding. A single-process limiter is
deliberate: the BFF is deployed beside its app, one process per host, and pulling
in a Redis dependency to count a handful of requests would be worse than the
problem.

Limits are per client and per bucket, counted over a sliding window.
"""

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

# bucket -> client key -> timestamps inside the current window
_HITS: dict[str, deque[float]] = defaultdict(deque)

# Bounds the dict's growth when many clients appear: beyond this many buckets the
# oldest entries are dropped rather than kept forever.
_MAX_KEYS = 10_000


def _client_key(request: Request, bucket: str) -> str:
    """Identify the caller.

    `X-Forwarded-For` is honoured because the app is normally reached through a
    proxy; the socket peer is the fallback.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
    else:
        ip = request.client.host if request.client else "unknown"
    return f"{bucket}:{ip}"


def rate_limit(bucket: str, limit: int, window_seconds: int):
    """Build a dependency that allows `limit` requests per `window_seconds`."""

    async def _dependency(request: Request) -> None:
        now = time.monotonic()
        key = _client_key(request, bucket)

        if len(_HITS) > _MAX_KEYS:
            _HITS.clear()

        hits = _HITS[key]
        while hits and now - hits[0] > window_seconds:
            hits.popleft()

        if len(hits) >= limit:
            retry_after = max(1, int(window_seconds - (now - hits[0])))
            raise HTTPException(
                429,
                "Too many requests — please wait a moment and try again",
                headers={"Retry-After": str(retry_after)},
            )

        hits.append(now)

    return _dependency


def reset_rate_limits() -> None:
    """Forget every counter. Used between tests so limits do not leak across them."""
    _HITS.clear()