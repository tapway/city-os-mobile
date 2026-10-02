"""Tests for POST /auth/password-login and GET /auth/config (option B sign-in).

The BFF performs the OAuth password grant against the INTERNAL Keycloak token
endpoint, so a phone never has to resolve Keycloak's container-name hostname.
Keycloak is mocked with respx; nothing here touches the network.
"""
import base64
import json
import logging
from urllib.parse import parse_qs

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from src.main import app
from src.settings import settings

PASSWORD = "s3cret-Pw-do-not-log"


def _jwt(payload: dict) -> str:
    seg = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"header.{seg}.sig"


def _token_url() -> str:
    return f"{settings.keycloak_url}/protocol/openid-connect/token"


def _ok_tokens() -> dict:
    return {
        "access_token": _jwt({"aud": "city-os-mobile"}),
        "refresh_token": "refresh-1",
        "expires_in": 300,
        "id_token": _jwt(
            {
                "sub": "user-ops-user",
                "preferred_username": "ops_user",
                "name": "Operations User",
                "realm_access": {"roles": ["officer"]},
            }
        ),
    }


def _post(client, body=None, **kwargs):
    return client.post(
        "/auth/password-login",
        json={"username": "ops_user", "password": PASSWORD} if body is None else body,
        **kwargs,
    )


# --- config ---------------------------------------------------------------


def test_config_defaults_to_password_mode():
    assert TestClient(app).get("/auth/config").json() == {"mode": "password"}


def test_config_reports_pkce_mode():
    settings.auth_mode = "pkce"
    assert TestClient(app).get("/auth/config").json() == {"mode": "pkce"}


def test_auth_mode_rejects_unknown_values():
    from src.settings import Settings

    with pytest.raises(ValueError):
        Settings(auth_mode="magic")


# --- success --------------------------------------------------------------


@respx.mock
def test_success_posts_password_grant_to_the_internal_endpoint():
    route = respx.post(_token_url()).mock(return_value=httpx.Response(200, json=_ok_tokens()))
    resp = _post(TestClient(app))

    assert resp.status_code == 200
    sent = parse_qs(route.calls.last.request.content.decode())
    assert sent["grant_type"] == ["password"]
    assert sent["client_id"] == [settings.keycloak_client_id]
    assert sent["username"] == ["ops_user"]
    assert sent["password"] == [PASSWORD]
    assert sent["scope"] == ["openid profile"]
    assert "client_secret" not in sent


@respx.mock
def test_success_sends_client_secret_when_configured():
    settings.keycloak_client_secret = "shh"
    route = respx.post(_token_url()).mock(return_value=httpx.Response(200, json=_ok_tokens()))
    _post(TestClient(app))
    assert parse_qs(route.calls.last.request.content.decode())["client_secret"] == ["shh"]


@respx.mock
def test_success_sets_the_same_session_as_the_callback(monkeypatch):
    from src import auth as auth_mod

    tokens = _ok_tokens()
    respx.post(_token_url()).mock(return_value=httpx.Response(200, json=tokens))

    async def fake_exchange(**kwargs):
        return tokens

    monkeypatch.setattr(auth_mod, "exchange_code_for_tokens", fake_exchange)

    for secure in (False, True):
        settings.cookie_secure = secure
        cb = TestClient(app)
        cb.cookies.set("oauth_state", "st")
        cb.cookies.set("pkce_verifier", "vf")
        cb_resp = cb.get("/auth/callback?code=abc&state=st", follow_redirects=False)
        pw_resp = _post(TestClient(app))
        assert pw_resp.status_code == 200

        def session_cookies(resp):
            out = {}
            for header in resp.headers.get_list("set-cookie"):
                name = header.split("=", 1)[0]
                if name in ("refresh_token", "session_user"):
                    out[name] = header
            return out

        assert session_cookies(pw_resp) == session_cookies(cb_resp)
        assert set(session_cookies(pw_resp)) == {"refresh_token", "session_user"}
        assert ("Secure" in session_cookies(pw_resp)["refresh_token"]) is secure
        assert "HttpOnly" in session_cookies(pw_resp)["refresh_token"]


@respx.mock
def test_success_body_matches_me_plus_access_token_and_me_works():
    respx.post(_token_url()).mock(return_value=httpx.Response(200, json=_ok_tokens()))
    client = TestClient(app)
    resp = _post(client)
    body = resp.json()

    me = client.get("/auth/me").json()
    assert me["username"] == "ops_user"
    for key, value in me.items():
        assert body[key] == value
    assert body["access_token"] == _ok_tokens()["access_token"]
    assert body["expires_in"] == 300
    assert "refresh_token" not in body and "password" not in resp.text


# --- errors ---------------------------------------------------------------


@respx.mock
def test_invalid_grant_is_401():
    respx.post(_token_url()).mock(
        return_value=httpx.Response(
            401, json={"error": "invalid_grant", "error_description": "Invalid user credentials"}
        )
    )
    resp = _post(TestClient(app))
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid username or password"}
    assert "session_user" not in resp.headers.get("set-cookie", "")


@respx.mock
def test_invalid_grant_400_is_also_401():
    respx.post(_token_url()).mock(
        return_value=httpx.Response(400, json={"error": "invalid_grant"})
    )
    assert _post(TestClient(app)).status_code == 401


@respx.mock
def test_account_not_fully_set_up_is_403():
    respx.post(_token_url()).mock(
        return_value=httpx.Response(
            400,
            json={"error": "invalid_grant", "error_description": "Account is not fully set up"},
        )
    )
    resp = _post(TestClient(app))
    assert resp.status_code == 403
    assert "set up in Keycloak" in resp.json()["detail"]


@respx.mock
def test_keycloak_5xx_is_503():
    respx.post(_token_url()).mock(return_value=httpx.Response(502, text="bad gateway"))
    assert _post(TestClient(app)).status_code == 503


@respx.mock
def test_keycloak_unreachable_is_503():
    respx.post(_token_url()).mock(side_effect=httpx.ConnectError("no route"))
    resp = _post(TestClient(app))
    assert resp.status_code == 503
    assert PASSWORD not in resp.text


@respx.mock
def test_misconfigured_client_is_503_not_a_wrong_password():
    respx.post(_token_url()).mock(
        return_value=httpx.Response(
            400, json={"error": "unauthorized_client", "error_description": "Direct grants off"}
        )
    )
    assert _post(TestClient(app)).status_code == 503


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"username": "ops_user"},
        {"password": PASSWORD},
        {"username": "", "password": PASSWORD},
        {"username": "   ", "password": PASSWORD},
        {"username": "ops_user", "password": ""},
        {"username": "ops_user", "password": "   "},
        {"username": 5, "password": PASSWORD},
        ["not", "an", "object"],
    ],
)
@respx.mock
def test_missing_or_blank_fields_are_422_and_never_reach_keycloak(body):
    route = respx.post(_token_url()).mock(return_value=httpx.Response(200, json=_ok_tokens()))
    resp = _post(TestClient(app), body=body)
    assert resp.status_code == 422
    assert not route.called
    assert PASSWORD not in resp.text  # FastAPI's default 422 would echo the input


def test_non_json_body_is_422():
    resp = TestClient(app).post("/auth/password-login", content=b"nope")
    assert resp.status_code == 422


@respx.mock
def test_password_never_appears_in_logs_or_responses(caplog):
    caplog.set_level(logging.DEBUG)
    cases = [
        httpx.Response(200, json=_ok_tokens()),
        httpx.Response(401, json={"error": "invalid_grant"}),
        httpx.Response(400, json={"error": "invalid_grant", "error_description": "Account is not fully set up"}),
        httpx.Response(500, text="boom"),
    ]
    for case in cases:
        respx.post(_token_url()).mock(return_value=case)
        resp = _post(TestClient(app))
        assert PASSWORD not in resp.text
        assert PASSWORD not in json.dumps(dict(resp.headers))
    respx.post(_token_url()).mock(side_effect=httpx.ConnectError("down"))
    assert PASSWORD not in _post(TestClient(app)).text
    assert PASSWORD not in caplog.text


# --- rate limit -----------------------------------------------------------


@respx.mock
def test_password_login_is_rate_limited():
    limit = settings.rate_limit_login_per_minute
    respx.post(_token_url()).mock(return_value=httpx.Response(401, json={"error": "invalid_grant"}))
    client = TestClient(app)
    codes = [_post(client).status_code for _ in range(limit + 2)]
    assert codes[:limit] == [401] * limit
    assert codes[limit:] == [429, 429]
    assert _post(client).headers["retry-after"]


# --- origin ---------------------------------------------------------------


@respx.mock
def test_foreign_origin_is_403_and_never_reaches_keycloak():
    route = respx.post(_token_url()).mock(return_value=httpx.Response(200, json=_ok_tokens()))
    resp = _post(TestClient(app), headers={"Origin": "https://evil.example"})
    assert resp.status_code == 403
    assert not route.called
    assert "set-cookie" not in resp.headers


@respx.mock
def test_allowlisted_origin_is_accepted():
    settings.pwa_origins = "http://localhost:5173,https://pwa.example.ts.net:9447"
    respx.post(_token_url()).mock(return_value=httpx.Response(200, json=_ok_tokens()))
    resp = _post(TestClient(app), headers={"Origin": "https://pwa.example.ts.net:9447"})
    assert resp.status_code == 200


@respx.mock
def test_absent_origin_is_accepted():
    respx.post(_token_url()).mock(return_value=httpx.Response(200, json=_ok_tokens()))
    assert _post(TestClient(app)).status_code == 200


@respx.mock
def test_token_bearing_responses_are_not_cacheable():
    respx.post(_token_url()).mock(return_value=httpx.Response(200, json=_ok_tokens()))
    client = TestClient(app)
    assert _post(client).headers["cache-control"] == "no-store"
    client.cookies.set("refresh_token", "r")
    refreshed = client.post("/auth/refresh")
    assert refreshed.status_code == 200
    assert refreshed.headers["cache-control"] == "no-store"
