from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    teable_api_token: Optional[str] = None
    teable_base_url: str = "https://app.teable.ai"
    teable_table_id: str = "tbl4fi155DuWlh40By3"
    teable_invoice_table_id: str = "tblyWvNkprE1HnaVZIH"
    openrouter_api_key: Optional[str] = None
    openrouter_model: str = "meta-llama/llama-4-maverick:free"
    frontend_url: str = "*"

    # Passwords — set via env vars / HF Space secrets, never hard-coded.
    # APP_PASSWORD   → editor role (full access)
    # APP_VIEW_PASSWORD → viewer role (read-only)
    # APP_WEB_PASSWORD  → web role (web invoice tracker only)
    app_password:       str = ""
    app_view_password:  str = ""
    app_web_password:   str = ""
    # Web invoice table — may live in a different Teable space with its own token.
    # TEABLE_WEB_API_TOKEN: token for tbllkYiaS68BlcOc1Jy (falls back to TEABLE_API_TOKEN if not set)
    teable_web_api_token: Optional[str] = None
    teable_web_invoice_table_id: str = "tbllkYiaS68BlcOc1Jy"
    # "all" role — web project tracker (Web Projects + Web Resources tables)
    # APP_ALL_PASSWORD → All@2024 (set via HF Space secret)
    app_all_password: str = ""
    # Optional dedicated token for the web projects Teable space.
    # Falls back to TEABLE_API_TOKEN (or TEABLE_WEB_API_TOKEN) if not set.
    teable_all_api_token: Optional[str] = None
    # Web Projects table (tbl4qgQkatguBwrzxtf)
    teable_web_projects_table_id: str = "tbl4qgQkatguBwrzxtf"
    # Web Resources table (tblMjssDx55GOfLtgqo)
    teable_web_resources_table_id: str = "tblMjssDx55GOfLtgqo"
    # Signing key for session tokens — set APP_SECRET in prod.
    app_secret: str = "fintrack-dev-secret-change-me"
    # How long a login token stays valid (seconds). Default 7 days.
    app_session_ttl: int = 7 * 24 * 3600

    class Config:
        env_file = ".env"


settings = Settings()
