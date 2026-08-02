"""PKCE (Proof Key for Code Exchange) helpers for OIDC.

Generates code verifier/challenge, builds Keycloak auth URL,
exchanges code for tokens, and refreshes access tokens.
All HTTP calls are async via httpx.
"""
import base64
import hashlib
import os
import logging
from typing import Optional
from urllib.parse import urlencode

import httpx

from .settings import settings

logger = logging.getLogger(__name__)


def generate_verifier_and_challenge() -> tuple[str, str]:
    """Generate PKCE code_verifier + code_challenge (S256).

    Returns (verifier, challenge) — verifier is a 43-char random string,
    challenge is base64url(sha256(verifier)) without padding.
    """
    verifier_bytes = os.urandom(32)
    verifier = base64.urlsafe_b64encode(verifier_bytes).rstrip(b"=").decode()
    challenge_bytes = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(challenge_bytes).rstrip(b"=").decode()
    return verifier, challenge


def build_auth_url(state: str, code_challenge: str) -> str:
    """Build Keycloak authorization URL with PKCE params."""
    params = {
        "client_id": settings.keycloak_client_id,
        "redirect_uri": settings.keycloak_redirect_uri,
        "response_type": "code",
        "scope": "openid profile",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{settings.keycloak_url}/protocol/openid-connect/auth?{urlencode(params)}"


async def exchange_code_for_tokens(code: str, code_verifier: str) -> Optional[dict]:
    """Exchange authorization code for tokens (server-side token exchange).

    The BFF holds the refresh token as an HttpOnly cookie — the PWA never sees it.
    """
    data = {
        "grant_type": "authorization_code",
        "client_id": settings.keycloak_client_id,
        "code": code,
        "redirect_uri": settings.keycloak_redirect_uri,
        "code_verifier": code_verifier,
    }
    if settings.keycloak_client_secret:
        data["client_secret"] = settings.keycloak_client_secret

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.post(
                f"{settings.keycloak_url}/protocol/openid-connect/token",
                data=data,
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "Token exchange failed: %s %s",
                exc.response.status_code,
                exc.response.text[:200],
            )
            return None
        except Exception as exc:
            logger.warning("Token exchange error: %s", exc)
            return None


async def refresh_access_token(refresh_token: str) -> Optional[dict]:
    """Use refresh token to get a new access token. Called by BFF refresh endpoint."""
    data = {
        "grant_type": "refresh_token",
        "client_id": settings.keycloak_client_id,
        "refresh_token": refresh_token,
    }
    if settings.keycloak_client_secret:
        data["client_secret"] = settings.keycloak_client_secret

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.post(
                f"{settings.keycloak_url}/protocol/openid-connect/token",
                data=data,
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "Token refresh failed: %s %s",
                exc.response.status_code,
                exc.response.text[:200],
            )
            return None
        except Exception as exc:
            logger.warning("Token refresh error: %s", exc)
            return None


async def revoke_token(refresh_token: str) -> bool:
    """Revoke refresh token at Keycloak. Called on logout."""
    data = {
        "client_id": settings.keycloak_client_id,
        "token": refresh_token,
        "token_type_hint": "refresh_token",
    }
    if settings.keycloak_client_secret:
        data["client_secret"] = settings.keycloak_client_secret

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(
                f"{settings.keycloak_url}/protocol/openid-connect/revoke",
                data=data,
            )
            return resp.status_code == 200
        except Exception as exc:
            logger.warning("Token revocation error: %s", exc)
            return False