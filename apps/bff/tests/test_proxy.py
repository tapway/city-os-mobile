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