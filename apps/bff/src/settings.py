from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Keycloak (public OIDC, PKCE)
    keycloak_url: str = "http://localhost:7080/realms/city-os"
    keycloak_client_id: str = "city-os-mobile"
    keycloak_client_secret: str = ""
    keycloak_redirect_uri: str = "http://localhost:5173/auth/callback"

    # Browser-facing Keycloak base. Keycloak renders absolute URLs (notably the
    # sign-in form's action) from the realm's frontendUrl, which on this stack is
    # the container name `deploy-keycloak-1:8080`. The browser must therefore be
    # sent to that same origin — not to the server-side one — or the form post
    # arrives without the session cookie ("Cookie not found"). Leave empty to use
    # keycloak_url.
    keycloak_public_url: str = ""

    # City Help API (proxied)
    city_help_api_url: str = "http://localhost:8001"

    # BFF
    cookie_domain: str = ""  # Empty = use request hostname
    # Set COOKIE_SECURE=true in any deployment that is not plain-http localhost:
    # the 12h refresh cookie is the session, and without this flag it is sent in
    # cleartext (and accepted by anyone who can read the wire).
    cookie_secure: bool = False

    # Cap on a single proxied upstream call, so a wedged City Help API cannot
    # pin a BFF worker forever.
    proxy_timeout_seconds: float = 30.0
    access_token_ttl_minutes: int = 5
    refresh_token_ttl_hours: int = 12

    # --- Browser origins -----------------------------------------------------
    # The PWA is served from localhost in development and from a tunnel or
    # reverse proxy in the field. The OIDC redirect URI is derived per origin
    # and validated against this allow list, so a crafted request cannot make
    # us hand tokens to a host we do not control.
    pwa_origins: str = "http://localhost:5173"

    # --- Image uploads -------------------------------------------------------
    # Evidence photos live in the City OS object store (MinIO) under this prefix,
    # which is also the only prefix the read endpoint will serve.
    uploads_prefix: str = "mobile-attachments"
    max_upload_bytes: int = 8 * 1024 * 1024
    allowed_upload_types: str = "image/jpeg,image/png,image/webp,image/heic,image/heif"

    minio_endpoint: str = ""
    minio_access_key: str = ""
    minio_secret_key: str = ""
    minio_bucket: str = "city-help"
    minio_secure: bool = False

    model_config = {"env_file": ".env", "extra": "allow"}

    # ---------------------------------------------------------------- helpers
    @property
    def browser_keycloak_url(self) -> str:
        """Keycloak base the browser is redirected to.

        Falls back to the server-side base, so a single-URL setup behaves as
        before. It must be an origin the browser can both reach and send the
        Keycloak session cookie back to.
        """
        return self.keycloak_public_url or self.keycloak_url

    @property
    def pwa_origins_list(self) -> list[str]:
        """Allowed browser origins (comma separated in the env)."""
        return [o.strip().rstrip("/") for o in self.pwa_origins.split(",") if o.strip()]

    @property
    def allowed_upload_types_list(self) -> list[str]:
        return [t.strip().lower() for t in self.allowed_upload_types.split(",") if t.strip()]

    @property
    def uploads_enabled(self) -> bool:
        """Uploads need an object store; without one the endpoint says so plainly."""
        return bool(self.minio_endpoint and self.minio_access_key and self.minio_secret_key)

    def redirect_uri_for(self, origin: str | None) -> str:
        """OIDC redirect URI for a browser origin, validated against the allow list.

        Falls back to the configured default so a misconfigured caller gets a
        deterministic (and rejectable) redirect rather than an open one.
        """
        if origin:
            candidate = origin.strip().rstrip("/")
            if candidate in self.pwa_origins_list:
                return f"{candidate}/auth/callback"
        return self.keycloak_redirect_uri


settings = Settings()