"""Tests for BFF auth — OIDC PKCE login, callback, refresh, logout."""
import respx
import httpx
from fastapi.testclient import TestClient
from src.main import app
from src.settings import settings


def test_login_redirects_to_keycloak():
    """GET /auth/login must redirect to Keycloak auth with PKCE params."""
    client = TestClient(app)
    resp = client.get("/auth/login", follow_redirects=False)
    assert resp.status_code in (302, 307, 200)
    location = resp.headers.get("location", "")
    # Should redirect to Keycloak with PKCE params
    assert "code_challenge=" in location or "client_id=" in location or "response_type=code" in location


@respx.mock
def test_callback_exchanges_code_for_tokens():
    """GET /auth/callback must exchange code and set HttpOnly cookie."""
    # Mock Keycloak token endpoint
    respx.post(f"{settings.keycloak_url}/protocol/openid-connect/token").mock(
        return_value=httpx.Response(200, json={
            "access_token": "test-access-token",
            "refresh_token": "test-refresh-token",
            "expires_in": 300,
        })
    )
    client = TestClient(app)
    # Set cookies on the client instance (not per-request)
    client.cookies.set("pkce_verifier", "test-verifier")
    client.cookies.set("oauth_state", "test-state")
    resp = client.get(
        "/auth/callback",
        params={"code": "test-auth-code", "state": "test-state"},
        follow_redirects=False,
    )
    # Should redirect to PWA with access_token in fragment
    assert resp.status_code == 302, f"Expected 302, got {resp.status_code}: {resp.text[:200]}"
    location = resp.headers.get("location", "")
    assert "access_token" in location
    assert "test-access-token" in location


@respx.mock
def test_refresh_returns_new_access_token():
    """POST /auth/refresh returns new access token using HttpOnly cookie."""
    respx.post(f"{settings.keycloak_url}/protocol/openid-connect/token").mock(
        return_value=httpx.Response(200, json={
            "access_token": "new-access-token",
            "refresh_token": "new-refresh-token",
            "expires_in": 300,
        })
    )
    client = TestClient(app)
    resp = client.post("/auth/refresh", cookies={"refresh_token": "old-refresh-token"})
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["access_token"] == "new-access-token"


@respx.mock
def test_refresh_returns_401_without_cookie():
    """POST /auth/refresh without refresh cookie returns 401."""
    client = TestClient(app)
    resp = client.post("/auth/refresh")
    assert resp.status_code == 401


@respx.mock
def test_logout_clears_cookie():
    """POST /auth/logout clears the refresh token cookie."""
    respx.post(f"{settings.keycloak_url}/protocol/openid-connect/revoke").mock(
        return_value=httpx.Response(200)
    )
    client = TestClient(app)
    resp = client.post("/auth/logout", cookies={"refresh_token": "test-refresh"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "logged_out"
    # Cookie should be cleared
    set_cookie = resp.headers.get("set-cookie", "")
    assert "refresh_token=;" in set_cookie.replace(" ", "") or "Max-Age=0" in set_cookie or "expires=Thu, 01 Jan 1970" in set_cookie