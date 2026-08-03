from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Keycloak (public OIDC, PKCE)
    keycloak_url: str = "http://localhost:7080/realms/city-os"
    keycloak_client_id: str = "city-os-mobile"
    keycloak_client_secret: str = ""
    keycloak_redirect_uri: str = "http://localhost:5173/auth/callback"

    # City Help API (proxied)
    city_help_api_url: str = "http://localhost:8001"

    # BFF
    cookie_domain: str = ""  # Empty = use request hostname
    cookie_secure: bool = False
    access_token_ttl_minutes: int = 5
    refresh_token_ttl_hours: int = 12

    model_config = {"env_file": ".env", "extra": "allow"}


settings = Settings()