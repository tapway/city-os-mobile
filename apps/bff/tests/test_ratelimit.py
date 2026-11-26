"""The limiter itself, and proof it is wired to the endpoints that need it."""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from src.main import app
from src.settings import settings
from src.ratelimit import rate_limit, reset_rate_limits

client = TestClient(app)


class FakeRequest:
    """Just enough of a Request for the dependency: headers + client."""

    def __init__(self, ip: str, forwarded: str | None = None):
        self.headers = {"x-forwarded-for": forwarded} if forwarded else {}
        self.client = type("C", (), {"host": ip})()


@pytest.mark.asyncio
async def test_limiter_allows_up_to_the_limit_then_refuses():
    dep = rate_limit("unit", limit=3, window_seconds=60)
    for _ in range(3):
        await dep(FakeRequest("10.0.0.1"))

    with pytest.raises(HTTPException) as exc:
        await dep(FakeRequest("10.0.0.1"))
    assert exc.value.status_code == 429
    assert exc.value.headers["Retry-After"]


@pytest.mark.asyncio
async def test_limiter_counts_each_client_separately():
    """One noisy officer must not lock out the rest of the shift."""
    dep = rate_limit("unit2", limit=2, window_seconds=60)
    await dep(FakeRequest("10.0.0.1"))
    await dep(FakeRequest("10.0.0.1"))
    await dep(FakeRequest("10.0.0.2"))  # a different caller still gets through


@pytest.mark.asyncio
async def test_limiter_honours_the_forwarded_client():
    """Behind the proxy every request shares the proxy's socket address, so the
    forwarded address is what actually identifies the caller."""
    dep = rate_limit("unit3", limit=1, window_seconds=60)
    await dep(FakeRequest("172.18.0.5", forwarded="203.0.113.9, 172.18.0.5"))
    await dep(FakeRequest("172.18.0.5", forwarded="203.0.113.10, 172.18.0.5"))


def test_login_is_rate_limited():
    """The wiring, not just the helper: /auth/login must actually 429.

    Login does a Keycloak round trip on every call and is reachable without a
    session, so an unbounded endpoint here is a free amplifier. The limit is read
    from settings so this test does not nail an operator-tunable number into the
    code.
    """
    limit = settings.rate_limit_login_per_minute
    reset_rate_limits()
    statuses = [client.get("/auth/login", follow_redirects=False).status_code for _ in range(limit + 2)]
    assert 429 not in statuses[:limit], f"the limiter fired too early: {statuses}"
    assert statuses[limit] == 429, f"no 429 after {limit} requests: {statuses}"
    resp = client.get("/auth/login", follow_redirects=False)
    assert resp.headers.get("Retry-After")
    reset_rate_limits()


def test_the_login_limit_leaves_room_for_a_shared_office_address():
    """Everyone behind one NAT shares a bucket.

    A limit low enough that a shift of officers signing in trips it would lock
    the whole office out of the app — the guard must not be the outage.
    """
    assert settings.rate_limit_login_per_minute >= 20
