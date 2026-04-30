from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    teable_api_token: Optional[str] = None
    teable_base_url: str = "https://app.teable.ai"
    teable_table_id: str = "tbl4fi155DuWlh40By3"
    teable_invoice_table_id: str = "tblyWvNkprE1HnaVZIH"
    openrouter_api_key: Optional[str] = None
    openrouter_model: str = "nvidia/nemotron-3-super-120b-a12b:free"
    frontend_url: str = "*"

    # Passwords — set via env vars / HF Space secrets, never hard-coded.
    # APP_PASSWORD   → editor role (full access)
    # APP_VIEW_PASSWORD → viewer role (read-only)
    # APP_WEB_PASSWORD  → web role (web invoice tracker only)
    app_password:       str = ""
    app_view_password:  str = ""
    app_web_password:   str = ""
    # Web invoice table — may live in a different Teable space with its own token.
    # TEABLE_WEB_API_TOKEN: token for tblT6iQNKe8CfAUN2iR (falls back to TEABLE_API_TOKEN if not set)
    teable_web_api_token: Optional[str] = None
    teable_web_invoice_table_id: str = "tblT6iQNKe8CfAUN2iR"
    # Signing key for session tokens — set APP_SECRET in prod.
    app_secret: str = "fintrack-dev-secret-change-me"
    # How long a login token stays valid (seconds). Default 7 days.
    app_session_ttl: int = 7 * 24 * 3600

    class Config:
        env_file = ".env"


settings = Settings()
