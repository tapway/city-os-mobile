"""Tests for BFF proxy — forwards to City Help API with access token."""
import respx
import httpx
from fastapi.testclient import TestClient
from src.main import app
from src.settings import settings


def test_proxy_returns_401_without_auth():
    """Proxy must 401 without Authorization header."""
    client = TestClient(app)
    resp = client.get("/api/v1/events")
    assert resp.status_code == 401
    assert "Missing Bearer token" in resp.text


@respx.mock
def test_proxy_forwards_get_with_auth():
    """Proxy must forward GET requests with Bearer token."""
    upstream_url = f"{settings.city_help_api_url}/api/v1/events"
    upstream_route = respx.get(upstream_url).mock(
        return_value=httpx.Response(200, json=[{"id": 1, "title": "Test"}])
    )
    client = TestClient(app)
    resp = client.get(
        "/api/v1/events",
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["title"] == "Test"
    # Verify the upstream request was called
    assert upstream_route.called, f"Upstream route {upstream_url} was not called"


@respx.mock
def test_proxy_preserves_path_and_query_params():
    """Proxy must preserve path + query params."""
    # Mock the exact upstream URL with query params
    upstream_url = f"{settings.city_help_api_url}/api/v1/events?status=OPEN&limit=10"
    upstream_route = respx.get(upstream_url).mock(
        return_value=httpx.Response(200, json={"data": "test"})
    )
    # Also allow the base URL (without query) to be unmatched
    respx.get(f"{settings.city_help_api_url}/api/v1/events").mock(
        return_value=httpx.Response(404)
    )
    client = TestClient(app)
    resp = client.get(
        "/api/v1/events?status=OPEN&limit=10",
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 200
    assert upstream_route.called, "Upstream route with query params was not called"


@respx.mock
def test_proxy_forwards_post_with_body():
    """Proxy must forward POST requests with JSON body."""
    upstream_url = f"{settings.city_help_api_url}/api/v1/attendance/clock-in"
    upstream_route = respx.post(upstream_url).mock(
        return_value=httpx.Response(200, json={"status": "present", "id": 1})
    )
    client = TestClient(app)
    resp = client.post(
        "/api/v1/attendance/clock-in",
        json={"lat": 1.5, "lng": 103.7},
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "present"
    assert upstream_route.called, f"Upstream route {upstream_url} was not called"


@respx.mock
def test_proxy_returns_502_on_upstream_error():
    """Proxy must return 502 when City Help is unreachable."""
    upstream_url = f"{settings.city_help_api_url}/api/v1/events"
    respx.get(upstream_url).mock(
        side_effect=httpx.ConnectError("Connection refused")
    )
    client = TestClient(app)
    resp = client.get(
        "/api/v1/events",
        headers={"Authorization": "Bearer test-token"},
    )
    assert resp.status_code == 502
    assert "City Help API unreachable" in resp.text


# ── Path-traversal guard ────────────────────────────────────────────────────
# httpx normalises dot segments *after* the upstream URL is built, so before
# this guard an unvalidated path escaped the /api prefix entirely: a live probe
# of GET /api/../openapi.json returned the 121 KB City Help OpenAPI schema with
# a junk token. Starlette percent-decodes before the handler sees the path, so
# the encoded form is decoded into a literal ".." and caught here too.


def test_proxy_rejects_encoded_traversal():
    """%2e%2e survives httpx normalisation, so the guard itself must reject it."""
    client = TestClient(app)
    resp = client.get(
        "/api/%2e%2e/openapi.json", headers={"Authorization": "Bearer test-token"}
    )
    assert resp.status_code == 400, resp.text


def test_proxy_rejects_absolute_path_smuggling():
    """A leading slash must not let a caller choose the upstream path."""
    client = TestClient(app)
    resp = client.get(
        "/api//openapi.json", headers={"Authorization": "Bearer test-token"}
    )
    assert resp.status_code in (400, 404), resp.text


@respx.mock(assert_all_called=False)  # the mock is a tripwire, not a requirement
def test_traversal_never_reaches_the_upstream_host():
    """Whatever the encoding, the request must not be forwarded upstream.

    Only the encodings that survive httpx's own normalisation are used here: a
    bare "./" is removed by httpx before the handler runs, so it never tests
    this guard. `%2e%2e` and `..%2f` do reach the handler, where Starlette has
    already decoded them into a literal "..".
    """
    base = settings.city_help_api_url.rstrip("/")
    leaked = respx.route(url__startswith=base).mock(
        return_value=httpx.Response(200, json={"leaked": True})
    )
    client = TestClient(app)
    for attack in ("/api/%2e%2e/openapi.json", "/api/..%2fopenapi.json"):
        resp = client.get(attack, headers={"Authorization": "Bearer test-token"})
        assert resp.status_code == 400, f"{attack} -> {resp.status_code}"
    assert not leaked.called, f"traversal reached the upstream host: {leaked.calls}"
