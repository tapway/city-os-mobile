"""OIDC PKCE auth endpoints — login redirect, callback, refresh, logout.

The BFF holds the refresh token as an HttpOnly cookie, never exposing it to
the PWA JavaScript context. The PWA receives only short-lived access tokens
in memory.
"""
import base64
import json
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

from .pkce import (
    PasswordGrantRejected,
    TransientAuthError,
    password_grant,
    build_auth_url,
    exchange_code_for_tokens,
    refresh_access_token,
    revoke_token,
    generate_verifier_and_challenge,
)
from .ratelimit import rate_limit
from .settings import settings

logger = logging.getLogger(__name__)
router = APIRouter()

PKCE_TTL_SECONDS = 600


def _origin_cookie_value(request: Request) -> str:
    """The browser origin resolved at /auth/login, reused at /callback.

    /auth/login and /auth/callback are both reached from the same browser
    origin, so the value stored at login is what the token exchange must
    repeat — deriving it again at callback time would break behind a proxy
    that rewrites the Host header.
    """
    return request.cookies.get("oauth_origin", "") or ""


def _redirect_uri(request: Request) -> str:
    return settings.redirect_uri_for(_origin_cookie_value(request) or None)


@router.get(
    "/login",
    dependencies=[
        Depends(rate_limit("login", limit=settings.rate_limit_login_per_minute, window_seconds=60))
    ],
)
async def login(request: Request, origin: str = ""):
    """Redirect to Keycloak OIDC authorization with PKCE.

    Stores the code_verifier, state and the resolved browser origin in
    short-lived HttpOnly cookies (10 min) so the callback can verify the
    response and repeat the exact redirect_uri.
    """
    verifier, challenge = generate_verifier_and_challenge()
    state = os.urandom(16).hex()
    redirect_uri = settings.redirect_uri_for(origin or None)
    # A rejected origin is invisible to the user — Keycloak answers with an error
    # page — so say it in the log, naming the fix.
    if origin.strip().rstrip("/") not in settings.pwa_origins_list:
        logger.warning(
            "Ignoring origin %r for the login redirect: not in PWA_ORIGINS (%s). "
            "Add it there to sign in from that address.",
            origin,
            settings.pwa_origins,
        )
    resolved_origin = redirect_uri[: -len("/auth/callback")]

    auth_url = build_auth_url(
        state=state,
        code_challenge=challenge,
        redirect_uri=redirect_uri,
    )

    response = Response(status_code=302)
    response.headers["Location"] = auth_url
    cookie_kwargs = {
        "httponly": True,
        "max_age": PKCE_TTL_SECONDS,
        "samesite": "lax",
        "secure": settings.cookie_secure,
        "path": "/",
    }
    response.set_cookie(key="pkce_verifier", value=verifier, **cookie_kwargs)
    response.set_cookie(key="oauth_state", value=state, **cookie_kwargs)
    response.set_cookie(key="oauth_origin", value=resolved_origin, **cookie_kwargs)
    return response


@router.get("/callback")
async def callback(
    request: Request,
    code: str = "",
    state: str = "",
    error: str = "",
):
    """OIDC callback: exchange code for tokens, set HttpOnly refresh cookie.

    Steps:
    1. Verify state matches the cookie to prevent CSRF
    2. Exchange code + verifier for tokens (server-side)
    3. Set refresh_token as HttpOnly cookie (12h)
    4. Redirect to the PWA with the access token in the URL fragment
    """
    if error:
        # Keycloak reports failures (e.g. missing role, user cancelled) here.
        logger.warning("OIDC provider returned error: %s", error)
        from urllib.parse import urlencode as _urlencode

        return RedirectResponse(
            url=f"/login?{_urlencode({'error': error[:200]})}", status_code=302
        )

    cookies = request.cookies
    expected_state = cookies.get("oauth_state", "")
    verifier = cookies.get("pkce_verifier", "")

    if not state or not expected_state or state != expected_state:
        raise HTTPException(400, "OAuth state mismatch — possible CSRF")
    if not verifier:
        raise HTTPException(400, "Missing PKCE code verifier")
    if not code:
        raise HTTPException(400, "Missing authorization code")

    tokens = await exchange_code_for_tokens(
        code=code,
        code_verifier=verifier,
        redirect_uri=_redirect_uri(request),
    )
    if not tokens or "access_token" not in tokens:
        raise HTTPException(400, "Token exchange failed")

    access_token = tokens["access_token"]
    expires_in = tokens.get("expires_in", settings.access_token_ttl_minutes * 60)

    # Redirect to the PWA with the access token in the fragment (never sent to
    # the server, and stripped from history by the app on arrival).
    response = RedirectResponse(
        url=f"/#access_token={access_token}&expires_in={expires_in}",
        status_code=302,
    )

    _set_session_cookies(response, tokens)

    # Clear the one-shot PKCE cookies
    response.delete_cookie("pkce_verifier", path="/")
    response.delete_cookie("oauth_state", path="/")
    response.delete_cookie("oauth_origin", path="/")

    return response


SESSION_USER_COOKIE = "session_user"


def _identity_claims(tokens: dict) -> dict:
    """Who is signed in, taken from the tokens Keycloak just returned.

    This realm's access token carries neither `preferred_username` nor `sub`
    (only a display `name`), so a client cannot name the officer from it — and
    the API needs an identifier it can persist, both on ticket events and as the
    `user_refs` foreign key behind GPS/attendance logging. The ID token has the
    claims and is already in hand here, so the identity is read from it and
    handed to the app through /auth/me.
    """
    for key in ("id_token", "access_token"):
        token = tokens.get(key)
        if not token:
            continue
        try:
            payload = token.split(".")[1]
            payload += "=" * (-len(payload) % 4)
            claims = json.loads(base64.urlsafe_b64decode(payload))
        except Exception:  # malformed payload — try the next token
            continue
        username, sub = claims.get("preferred_username"), claims.get("sub")
        if username or sub:
            return {
                "sub": sub,
                "username": username,
                "name": claims.get("name"),
                "roles": (claims.get("realm_access") or {}).get("roles", []),
            }
    return {}


def _set_identity_cookie(response: Response, tokens: dict) -> None:
    """Remember the identity for /auth/me. Not a credential: claims only."""
    identity = _identity_claims(tokens)
    if not identity:
        return
    response.set_cookie(
        key=SESSION_USER_COOKIE,
        value=json.dumps(identity),
        httponly=True,
        max_age=settings.refresh_token_ttl_hours * 3600,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def _set_refresh_cookie(response: Response, refresh_token: str | None) -> None:
    if not refresh_token:
        return
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        max_age=settings.refresh_token_ttl_hours * 3600,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def _set_session_cookies(response: Response, tokens: dict) -> None:
    """The session a successful sign-in establishes, whichever way it got here.

    Shared by /auth/callback (PKCE) and /auth/password-login so both produce
    identical cookies, flags and /auth/me results.
    """
    _set_refresh_cookie(response, tokens.get("refresh_token"))
    _set_identity_cookie(response, tokens)


def _token_response(access_token: str, expires_in: int, refresh_token: str | None) -> Response:
    """Serialise the token payload with json.dumps — never string interpolation.

    Building the body with an f-string would produce invalid JSON (or allow
    injection) for any token containing a quote or backslash.
    """
    payload = {"access_token": access_token, "expires_in": expires_in}
    response = Response(
        content=json.dumps(payload),
        media_type="application/json",
        status_code=200,
    )
    _set_refresh_cookie(response, refresh_token)
    return response


@router.post(
    "/refresh",
    dependencies=[
        Depends(
            rate_limit(
                "refresh", limit=settings.rate_limit_refresh_per_minute, window_seconds=60
            )
        )
    ],
)
async def refresh(request: Request):
    """Silent renew using the HttpOnly refresh cookie.

    Returns a new access token. The PWA calls this on start-up and whenever an
    API call comes back 401, so a user is not signed out while the cookie lives.
    """
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(401, "No refresh token cookie — please log in again")

    try:
        tokens = await refresh_access_token(refresh_token)
    except TransientAuthError:
        # Keycloak unreachable or erroring: keep the cookie and let the client
        # retry. Clearing it here is what used to sign users out on a blip.
        return Response(
            status_code=503,
            content=json.dumps({"error": "Auth service unavailable — retry"}),
            media_type="application/json",
        )
    if not tokens or "access_token" not in tokens:
        # Clear the stale cookie so the client stops retrying it.
        response = Response(
            status_code=401,
            content=json.dumps({"error": "Session expired — please log in again"}),
            media_type="application/json",
        )
        response.delete_cookie("refresh_token", path="/")
        return response

    response = _token_response(
        access_token=tokens["access_token"],
        expires_in=tokens.get("expires_in", settings.access_token_ttl_minutes * 60),
        refresh_token=tokens.get("refresh_token"),
    )
    _set_identity_cookie(response, tokens)
    return response


@router.post("/logout")
async def logout(request: Request):
    """Logout: revoke refresh token at Keycloak, clear cookie."""
    refresh_token = request.cookies.get("refresh_token")

    if refresh_token:
        await revoke_token(refresh_token)

    response = Response(
        content=json.dumps({"status": "logged_out"}),
        media_type="application/json",
        status_code=200,
    )
    response.delete_cookie("refresh_token", path="/")
    response.delete_cookie(SESSION_USER_COOKIE, path="/")
    response.delete_cookie("pkce_verifier", path="/")
    response.delete_cookie("oauth_state", path="/")
    response.delete_cookie("oauth_origin", path="/")
    return response


@router.get("/me")
async def me(request: Request):
    """Who the PWA is signed in as.

    The app uses this for attribution on ticket events and as the acting user on
    GPS/attendance writes, which it cannot read from the access token this realm
    issues (see _identity_claims).
    """
    raw = request.cookies.get(SESSION_USER_COOKIE)
    if not raw:
        raise HTTPException(401, "Not signed in")
    try:
        return json.loads(raw)
    except ValueError:
        raise HTTPException(401, "Not signed in")



@router.get("/config")
async def auth_config():
    """Which sign-in the PWA should offer: its own form ("password") or the
    Keycloak redirect ("pkce")."""
    return {"mode": settings.auth_mode}


def _reject_foreign_origin(request: Request) -> None:
    """Sign-in sets session cookies, so a cross-site page must not be able to
    drive it. Browsers always send Origin on a cross-origin POST; a request with
    none (curl, server-to-server) is not a browser CSRF vector and is allowed."""
    origin = request.headers.get("origin")
    if origin is None:
        return
    if origin.strip().rstrip("/") not in settings.pwa_origins_list:
        logger.warning("Rejected password login from origin %r (not in PWA_ORIGINS)", origin)
        raise HTTPException(403, "Origin not allowed")


def _credentials(payload: object) -> tuple[str, str]:
    """Validate by hand: FastAPI's default 422 body echoes the offending input,
    which here would put the password in the response."""
    if not isinstance(payload, dict):
        raise HTTPException(422, "Username and password are required")
    username, password = payload.get("username"), payload.get("password")
    if (
        not isinstance(username, str)
        or not isinstance(password, str)
        or not username.strip()
        or not password.strip()
    ):
        raise HTTPException(422, "Username and password are required")
    return username.strip(), password


@router.post(
    "/password-login",
    dependencies=[
        Depends(
            rate_limit(
                "password-login",
                limit=settings.rate_limit_login_per_minute,
                window_seconds=60,
            )
        )
    ],
)
async def password_login(request: Request):
    """Sign in with a username and password (auth mode "password").

    The BFF performs the OAuth password grant against the internal Keycloak
    token endpoint and then establishes exactly the session /auth/callback
    does. Response body: the /auth/me identity (sub, username, name, roles) plus
    `access_token` and `expires_in`, so the PWA needs no follow-up call. The
    refresh token stays in its HttpOnly cookie and is never in the body.
    """
    _reject_foreign_origin(request)
    try:
        payload = await request.json()
    except ValueError:
        raise HTTPException(422, "Username and password are required")
    username, password = _credentials(payload)

    try:
        tokens = await password_grant(username, password)
    except PasswordGrantRejected as rejected:
        if rejected.reason == "account_setup_required":
            raise HTTPException(
                403,
                "This account is not fully set up yet. It needs to be set up in Keycloak "
                "(required actions pending) - ask an administrator.",
            )
        raise HTTPException(401, "Invalid username or password")
    except TransientAuthError:
        raise HTTPException(503, "Sign-in service unavailable - please retry")

    body = {
        **_identity_claims(tokens),
        "access_token": tokens["access_token"],
        "expires_in": tokens.get("expires_in", settings.access_token_ttl_minutes * 60),
    }
    response = Response(
        content=json.dumps(body), media_type="application/json", status_code=200
    )
    _set_session_cookies(response, tokens)
    return response
