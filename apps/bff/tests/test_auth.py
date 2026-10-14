"""Tests for BFF auth — OIDC PKCE login, callback, refresh, logout.

Covers the two defects fixed in this change:
  * the redirect_uri must follow the browser origin (tunnel or localhost)
    and never an origin outside the configured allow list
  * the token response body must be serialised as JSON, not interpolated
"""
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


def test_login_uses_allowlisted_origin_for_redirect_uri():
    """A tunnelled origin in the allow list becomes the redirect_uri."""
    settings.pwa_origins = "http://localhost:5173,https://pwa.example.ts.net:9447"
    client = TestClient(app)
    resp = client.get(
        "/auth/login",
        params={"origin": "https://pwa.example.ts.net:9447"},
        follow_redirects=False,
    )
    location = resp.headers["location"]
    assert "redirect_uri=https%3A%2F%2Fpwa.example.ts.net%3A9447%2Fauth%2Fcallback" in location


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
def test_tunnel_origin_survives_the_cookie_round_trip():
    """A tunnel login must exchange its code with the tunnel redirect_uri.

    The origin travels to /auth/callback in a cookie, and cookie values are
    quoted on the wire. If the quotes were not unwrapped, the allow-list match
    would fail and the exchange would silently fall back to localhost — which
    Keycloak rejects, breaking every remote login.
    """
    route = respx.post(f"{settings.keycloak_url}/protocol/openid-connect/token").mock(
        return_value=httpx.Response(200, json={
            "access_token": "tok",
            "refresh_token": "ref",
            "expires_in": 300,
        })
    )
    settings.pwa_origins = "http://localhost:5173,https://pwa.example.ts.net:9447"
    client = TestClient(app)

    login = client.get(
        "/auth/login",
        params={"origin": "https://pwa.example.ts.net:9447"},
        follow_redirects=False,
    )
    assert login.status_code == 302

    resp = client.get(
        "/auth/callback",
        params={"code": "c", "state": client.cookies.get("oauth_state")},
        follow_redirects=False,
    )
    assert resp.status_code == 302, resp.text[:200]
    sent = route.calls.last.request.content.decode()
    assert "redirect_uri=https%3A%2F%2Fpwa.example.ts.net%3A9447%2Fauth%2Fcallback" in sent


def test_callback_reports_provider_errors_instead_of_500():
    """Keycloak failures (user cancelled, missing role) redirect with the reason."""
    client = TestClient(app)
    resp = client.get(
        "/auth/callback",
        params={"error": "access_denied"},
        follow_redirects=False,
    )
    assert resp.status_code == 302
    assert "error=access_denied" in resp.headers["location"]


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
def test_refresh_encodes_tokens_as_valid_json():
    """A token containing quotes must not corrupt the response body.

    The body used to be built by string interpolation, which produced invalid
    JSON for any token with a quote or backslash in it.
    """
    tricky = 'abc"def\\ghi'
    respx.post(f"{settings.keycloak_url}/protocol/openid-connect/token").mock(
        return_value=httpx.Response(200, json={
            "access_token": tricky,
            "refresh_token": "ref",
            "expires_in": 300,
        })
    )
    client = TestClient(app)
    resp = client.post("/auth/refresh", cookies={"refresh_token": "old"})
    assert resp.status_code == 200
    assert resp.json()["access_token"] == tricky


@respx.mock
def test_refresh_returns_401_without_cookie():
    """POST /auth/refresh without refresh cookie returns 401."""
    client = TestClient(app)
    resp = client.post("/auth/refresh")
    assert resp.status_code == 401


@respx.mock
def test_refresh_clears_cookie_when_keycloak_rejects_it():
    """A dead refresh token must be cleared, not retried on every request."""
    respx.post(f"{settings.keycloak_url}/protocol/openid-connect/token").mock(
        return_value=httpx.Response(400, json={"error": "invalid_grant"})
    )
    client = TestClient(app)
    resp = client.post("/auth/refresh", cookies={"refresh_token": "stale"})
    assert resp.status_code == 401
    assert "max-age=0" in resp.headers["set-cookie"].replace(" ", "").lower()


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


def test_login_redirects_the_browser_to_the_browser_facing_keycloak_base():
    """The browser must land on the origin Keycloak renders its form action for.

    The realm pins frontendUrl to the container name, so a redirect to the
    server-side base yields a page whose form posts to a different origin — and
    the post then arrives without the session cookie.
    """
    settings.keycloak_url = "http://localhost:7080/realms/city-os"
    settings.keycloak_public_url = "http://deploy-keycloak-1:8080/realms/city-os"
    client = TestClient(app)
    resp = client.get("/auth/login", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"].startswith(
        "http://deploy-keycloak-1:8080/realms/city-os/protocol/openid-connect/auth?"
    )


@respx.mock
def test_token_exchange_uses_the_server_side_base_not_the_browser_one():
    """Code exchange is server-to-server: it must not depend on the browser host."""
    route = respx.post(
        "http://localhost:7080/realms/city-os/protocol/openid-connect/token"
    ).mock(
        return_value=httpx.Response(200, json={
            "access_token": "tok",
            "refresh_token": "ref",
            "expires_in": 300,
        })
    )
    settings.keycloak_url = "http://localhost:7080/realms/city-os"
    settings.keycloak_public_url = "http://deploy-keycloak-1:8080/realms/city-os"
    client = TestClient(app)
    client.cookies.set("pkce_verifier", "test-verifier")
    client.cookies.set("oauth_state", "test-state")
    resp = client.get(
        "/auth/callback",
        params={"code": "c", "state": "test-state"},
        follow_redirects=False,
    )
    assert resp.status_code == 302, resp.text[:200]
    assert route.called


def test_refresh_survives_a_transient_identity_provider_failure(monkeypatch):
    """A Keycloak blip must not sign the officer out.

    When the identity provider is unreachable or 5xx the refresh token is very
    likely still valid, so the cookie has to stay: clearing it here is what
    turned a momentary outage into a permanent logout.
    """
    from src import auth as auth_mod
    from src.pkce import TransientAuthError

    async def unreachable(refresh_token):
        raise TransientAuthError("keycloak unreachable")

    monkeypatch.setattr(auth_mod, "refresh_access_token", unreachable)

    client = TestClient(app)
    client.cookies.set("refresh_token", "probably-still-good")
    resp = client.post("/auth/refresh")

    assert resp.status_code == 503
    assert "refresh_token=;" not in resp.headers.get("set-cookie", ""), (
        "the cookie was cleared on a transient failure"
    )


def test_refresh_clears_cookie_when_the_token_is_really_dead(monkeypatch):
    """A definitive rejection (invalid_grant) still clears the cookie."""
    from src import auth as auth_mod

    async def rejected(refresh_token):
        return None

    monkeypatch.setattr(auth_mod, "refresh_access_token", rejected)

    client = TestClient(app)
    client.cookies.set("refresh_token", "revoked")
    resp = client.post("/auth/refresh")

    assert resp.status_code == 401
    assert "refresh_token" in resp.headers.get("set-cookie", "")

def test_callback_remembers_the_identity_for_me(monkeypatch):
    """The app cannot read the officer's identity from the access token, so the
    BFF keeps it and serves it at /auth/me."""
    import base64, json as _json
    from src import auth as auth_mod

    def _jwt(payload: dict) -> str:
        seg = base64.urlsafe_b64encode(_json.dumps(payload).encode()).decode().rstrip("=")
        return f"header.{seg}.sig"

    id_token = _jwt({
        "sub": "user-ops-user",
        "preferred_username": "ops_user",
        "name": "Operations User",
        "realm_access": {"roles": ["officer"]},
    })

    async def fake_exchange(**kwargs):
        return {"access_token": _jwt({"aud": "city-os-mobile"}), "refresh_token": "r", "id_token": id_token}

    monkeypatch.setattr(auth_mod, "exchange_code_for_tokens", fake_exchange)

    client = TestClient(app)
    client.cookies.set("oauth_state", "st")
    client.cookies.set("pkce_verifier", "vf")
    resp = client.get("/auth/callback?code=abc&state=st", follow_redirects=False)

    assert resp.status_code == 302
    assert "session_user" in resp.headers.get("set-cookie", "")

    me = client.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "ops_user"
    assert me.json()["sub"] == "user-ops-user"


def test_me_is_401_without_a_session():
    resp = TestClient(app).get("/auth/me")
    assert resp.status_code == 401


def _unquoted_location(resp) -> str:
    from urllib.parse import unquote

    return unquote(resp.headers["location"])


def test_login_honours_the_origin_the_app_reports():
    """The app tells the BFF which address it is served from, and the allow list
    decides. This is what makes a tunnel or LAN address work at all: the BFF
    cannot infer it, because the proxy rewrites Host to the upstream address."""
    settings.pwa_origins = "http://localhost:5173,https://pwa.example.ts.net:9447"
    client = TestClient(app)
    resp = client.get(
        "/auth/login",
        params={"origin": "https://pwa.example.ts.net:9447"},
        follow_redirects=False,
    )
    location = _unquoted_location(resp)
    assert "redirect_uri=https://pwa.example.ts.net:9447/auth/callback" in location, location


def test_login_never_derives_the_redirect_from_the_host_header():
    """A proxied request must not have its Host treated as the app's origin.

    Both vite (`changeOrigin: true`) and a reverse proxy rewrite Host to the
    upstream address, so deriving the origin from it yields the BFF's internal
    address — Keycloak then answers with an error page instead of a sign-in form.
    """
    settings.pwa_origins = "http://localhost:5173"
    client = TestClient(app)
    resp = client.get(
        "/auth/login",
        headers={"Host": "localhost:8002", "X-Forwarded-Proto": "https"},
        follow_redirects=False,
    )
    location = _unquoted_location(resp)
    assert "redirect_uri=http://localhost:5173/auth/callback" in location, location


def test_login_ignores_an_origin_outside_the_allow_list():
    """An attacker-supplied origin must not become the redirect_uri.

    It falls back to the configured default, so the authorization code is never
    delivered to a host of the attacker's choosing.
    """
    settings.pwa_origins = "http://localhost:5173"
    client = TestClient(app)
    resp = client.get(
        "/auth/login",
        params={"origin": "https://evil.example.com"},
        follow_redirects=False,
    )
    location = _unquoted_location(resp)
    assert "evil.example.com" not in location
    assert "redirect_uri=http://localhost:5173/auth/callback" in location, location
