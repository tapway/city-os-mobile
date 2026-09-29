"""OIDC PKCE auth endpoints — login redirect, callback, refresh, logout.

The BFF holds the refresh token as an HttpOnly cookie, never exposing it to
the PWA JavaScript context. The PWA receives only short-lived access tokens
in memory.
"""
import json
import logging
import os

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

from .pkce import (
    TransientAuthError,
    build_auth_url,
    exchange_code_for_tokens,
    refresh_access_token,
    revoke_token,
    generate_verifier_and_challenge,
)
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


@router.get("/login")
async def login(request: Request, origin: str = ""):
    """Redirect to Keycloak OIDC authorization with PKCE.

    Stores the code_verifier, state and the resolved browser origin in
    short-lived HttpOnly cookies (10 min) so the callback can verify the
    response and repeat the exact redirect_uri.
    """
    verifier, challenge = generate_verifier_and_challenge()
    state = os.urandom(16).hex()
    redirect_uri = settings.redirect_uri_for(origin or None)
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
    refresh_token = tokens.get("refresh_token", "")
    expires_in = tokens.get("expires_in", settings.access_token_ttl_minutes * 60)

    # Redirect to the PWA with the access token in the fragment (never sent to
    # the server, and stripped from history by the app on arrival).
    response = RedirectResponse(
        url=f"/#access_token={access_token}&expires_in={expires_in}",
        status_code=302,
    )

    if refresh_token:
        response.set_cookie(
            key="refresh_token",
            value=refresh_token,
            httponly=True,
            max_age=settings.refresh_token_ttl_hours * 3600,
            samesite="lax",
            secure=settings.cookie_secure,
            path="/",
        )

    # Clear the one-shot PKCE cookies
    response.delete_cookie("pkce_verifier", path="/")
    response.delete_cookie("oauth_state", path="/")
    response.delete_cookie("oauth_origin", path="/")

    return response


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
    if refresh_token:
        response.set_cookie(
            key="refresh_token",
            value=refresh_token,
            httponly=True,
            max_age=settings.refresh_token_ttl_hours * 3600,
            samesite="lax",
            secure=settings.cookie_secure,
            path="/",
        )
    return response


@router.post("/refresh")
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

    return _token_response(
        access_token=tokens["access_token"],
        expires_in=tokens.get("expires_in", settings.access_token_ttl_minutes * 60),
        refresh_token=tokens.get("refresh_token"),
    )


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
    response.delete_cookie("pkce_verifier", path="/")
    response.delete_cookie("oauth_state", path="/")
    response.delete_cookie("oauth_origin", path="/")
    return response