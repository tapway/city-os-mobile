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


def build_auth_url(
    state: str,
    code_challenge: str,
    redirect_uri: str | None = None,
    scope: str = "openid profile",
) -> str:
    """Build Keycloak authorization URL with PKCE params.

    `redirect_uri` must be byte-identical to the one sent in the token
    exchange, so callers pass the same value to both.
    """
    params = {
        "client_id": settings.keycloak_client_id,
        "redirect_uri": redirect_uri or settings.keycloak_redirect_uri,
        "response_type": "code",
        "scope": scope,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    # The browser must be sent to the same origin Keycloak renders its form
    # action against, or the form post lands without the session cookie.
    return f"{settings.browser_keycloak_url}/protocol/openid-connect/auth?{urlencode(params)}"


async def exchange_code_for_tokens(
    code: str,
    code_verifier: str,
    redirect_uri: str | None = None,
) -> Optional[dict]:
    """Exchange authorization code for tokens (server-side token exchange).

    The BFF holds the refresh token as an HttpOnly cookie — the PWA never sees it.
    """
    data = {
        "grant_type": "authorization_code",
        "client_id": settings.keycloak_client_id,
        "code": code,
        "redirect_uri": redirect_uri or settings.keycloak_redirect_uri,
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


class TransientAuthError(RuntimeError):
    """The identity provider could not be reached — the token may still be good.

    Callers must NOT discard the refresh cookie in this case; the user is not
    signed out, the check simply has to be retried.
    """


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
            # 4xx: the refresh token is genuinely dead (invalid_grant, revoked,
            # expired) — the caller may clear it. 5xx: Keycloak is unwell and the
            # token is probably still valid, so it must survive.
            if exc.response.status_code < 500:
                logger.warning(
                    "Token refresh rejected: %s %s",
                    exc.response.status_code,
                    exc.response.text[:200],
                )
                return None
            logger.warning(
                "Token refresh failed transiently: %s", exc.response.status_code
            )
            raise TransientAuthError(str(exc)) from exc
        except Exception as exc:
            logger.warning("Token refresh unreachable: %s", exc)
            raise TransientAuthError(str(exc)) from exc


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


class PasswordGrantRejected(Exception):
    """Keycloak refused the credentials or the account.

    `reason` is "invalid_credentials" or "account_setup_required". The message
    deliberately carries nothing from the request.
    """

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


async def password_grant(username: str, password: str, scope: str = "openid profile") -> dict:
    """OAuth password grant against the INTERNAL token endpoint.

    Returns the token payload. Raises PasswordGrantRejected for bad credentials
    or an account with pending required actions, TransientAuthError for anything
    that is the service's fault (unreachable, 5xx, misconfigured client).

    Never logs the request body or the password: only status and error code.
    """
    data = {
        "grant_type": "password",
        "client_id": settings.keycloak_client_id,
        "username": username,
        "password": password,
        "scope": scope,
    }
    if settings.keycloak_client_secret:
        data["client_secret"] = settings.keycloak_client_secret

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{settings.keycloak_url}/protocol/openid-connect/token", data=data
            )
    except httpx.HTTPError as exc:
        logger.warning("Password grant: Keycloak unreachable (%s)", type(exc).__name__)
        raise TransientAuthError("Keycloak unreachable") from exc

    if resp.status_code == 200:
        try:
            tokens = resp.json()
        except ValueError as exc:
            raise TransientAuthError("Keycloak returned a non-JSON token response") from exc
        if "access_token" not in tokens:
            raise TransientAuthError("Keycloak token response had no access_token")
        return tokens

    try:
        body = resp.json()
        error = str(body.get("error", ""))
        description = str(body.get("error_description", ""))
    except ValueError:
        error = description = ""

    if resp.status_code < 500 and error == "invalid_grant":
        if "not fully set up" in description.lower():
            logger.info("Password grant: account needs setup in Keycloak")
            raise PasswordGrantRejected("account_setup_required")
        logger.info("Password grant: invalid credentials")
        raise PasswordGrantRejected("invalid_credentials")

    # 5xx, or a 4xx that is not about the user (invalid_client,
    # unauthorized_client: direct access grants off, wrong secret...). That is
    # an operator problem, so it must not read as "wrong password".
    logger.warning("Password grant failed: status=%s error=%s", resp.status_code, error[:60])
    raise TransientAuthError(f"Keycloak token endpoint answered {resp.status_code}")
