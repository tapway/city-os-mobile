"""OIDC PKCE auth endpoints — login redirect, callback, refresh, logout.

The BFF holds the refresh token as an HttpOnly cookie, never exposing it to
the PWA JavaScript context. The PWA receives only short-lived access tokens
in memory.
"""
import logging
import os
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

from .pkce import (
    build_auth_url,
    exchange_code_for_tokens,
    refresh_access_token,
    revoke_token,
    generate_verifier_and_challenge,
)
from .settings import settings

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/login")
async def login(request: Request):
    """Redirect to Keycloak OIDC authorization with PKCE.

    Stores the code_verifier and state in short-lived HttpOnly cookies
    (10 min) so the callback can verify the response.
    """
    verifier, challenge = generate_verifier_and_challenge()
    state = os.urandom(16).hex()
    auth_url = build_auth_url(state=state, code_challenge=challenge)

    response = Response(status_code=302)
    response.headers["Location"] = auth_url
    response.set_cookie(
        key="pkce_verifier",
        value=verifier,
        httponly=True,
        max_age=600,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    response.set_cookie(
        key="oauth_state",
        value=state,
        httponly=True,
        max_age=600,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    return response


@router.get("/callback")
async def callback(
    request: Request,
    code: str = "",
    state: str = "",
):
    """OIDC callback: exchange code for tokens, set HttpOnly refresh cookie.

    Steps:
    1. Verify state matches the cookie to prevent CSRF
    2. Exchange code + verifier for tokens (server-side)
    3. Set refresh_token as HttpOnly cookie (12h)
    4. Redirect to PWA with access_token in URL fragment
    """
    cookies = request.cookies
    expected_state = cookies.get("oauth_state", "")
    verifier = cookies.get("pkce_verifier", "")

    if not state or not expected_state or state != expected_state:
        raise HTTPException(400, "OAuth state mismatch — possible CSRF")
    if not verifier:
        raise HTTPException(400, "Missing PKCE code verifier")

    tokens = await exchange_code_for_tokens(code=code, code_verifier=verifier)
    if not tokens or "access_token" not in tokens:
        raise HTTPException(400, "Token exchange failed")

    access_token = tokens["access_token"]
    refresh_token = tokens.get("refresh_token", "")
    expires_in = tokens.get("expires_in", settings.access_token_ttl_minutes * 60)

    # Redirect to PWA with access token in fragment (never sent to server)
    response = RedirectResponse(
        url=f"/#access_token={access_token}&expires_in={expires_in}",
        status_code=302,
    )

    # Set refresh token as HttpOnly cookie (12h, SameSite=Lax)
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        max_age=settings.refresh_token_ttl_hours * 3600,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )

    # Clear PKCE cookies
    response.delete_cookie("pkce_verifier", path="/")
    response.delete_cookie("oauth_state", path="/")

    return response


@router.post("/refresh")
async def refresh(request: Request):
    """Silent renew using the HttpOnly refresh cookie.

    Returns a new access token. The PWA calls this when the current access
    token expires (detected by a 401 response from the API).
    """
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(401, "No refresh token cookie — please log in again")

    tokens = await refresh_access_token(refresh_token)
    if not tokens or "access_token" not in tokens:
        # Clear the stale cookie
        response = Response(
            status_code=401,
            content='{"error":"Session expired — please log in again"}',
            media_type="application/json",
        )
        response.delete_cookie("refresh_token", path="/")
        return response

    # Update the refresh token (Keycloak rotates it)
    if "refresh_token" in tokens:
        response = Response(
            content=f'{{"access_token":"{tokens["access_token"]}","expires_in":{tokens.get("expires_in", settings.access_token_ttl_minutes * 60)}}}',
            media_type="application/json",
            status_code=200,
        )
        response.set_cookie(
            key="refresh_token",
            value=tokens["refresh_token"],
            httponly=True,
            max_age=settings.refresh_token_ttl_hours * 3600,
            samesite="lax",
            secure=settings.cookie_secure,
            path="/",
        )
        return response

    return {
        "access_token": tokens["access_token"],
        "expires_in": tokens.get("expires_in", settings.access_token_ttl_minutes * 60),
    }


@router.post("/logout")
async def logout(request: Request):
    """Logout: revoke refresh token at Keycloak, clear cookie."""
    refresh_token = request.cookies.get("refresh_token")

    if refresh_token:
        await revoke_token(refresh_token)

    response = Response(
        content='{"status":"logged_out"}',
        media_type="application/json",
        status_code=200,
    )
    response.delete_cookie("refresh_token", path="/")
    response.delete_cookie("pkce_verifier", path="/")
    response.delete_cookie("oauth_state", path="/")
    return response