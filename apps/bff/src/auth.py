"""OIDC PKCE auth — login redirect, callback, refresh, logout."""
from fastapi import APIRouter, HTTPException, Request

router = APIRouter()


@router.get("/login")
async def login():
    """Redirect to Keycloak OIDC + PKCE."""
    # TODO Task 6: implement PKCE challenge + redirect
    return {"url": f"/auth/callback?code=placeholder"}


@router.get("/callback")
async def callback(code: str, state: str = ""):
    """Exchange code for tokens, set HttpOnly cookie."""
    # TODO Task 6
    return {"access_token": "placeholder", "expires_in": 300}


@router.post("/refresh")
async def refresh(request: Request):
    """Silent renew using HttpOnly refresh cookie."""
    # TODO Task 6
    return {"access_token": "placeholder", "expires_in": 300}


@router.post("/logout")
async def logout():
    """Revoke tokens at Keycloak, clear cookie."""
    # TODO Task 6
    return {"status": "logged_out"}