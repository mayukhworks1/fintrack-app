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

    # App access password — case-insensitive. Lives server-side only.
    # Override via APP_PASSWORD env var / HF Space secret.
    app_password: str = "tw@2026"
    # Signing key for session tokens. Override via APP_SECRET env var in prod.
    app_secret: str = "fintrack-dev-secret-change-me"
    # How long a login token stays valid (seconds). Default 7 days.
    app_session_ttl: int = 7 * 24 * 3600

    class Config:
        env_file = ".env"


settings = Settings()
