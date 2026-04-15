from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    teable_api_token: Optional[str] = None
    teable_base_url: str = "https://app.teable.ai"
    teable_table_id: str = "tbl4fi155DuWlh40By3"
    openrouter_api_key: Optional[str] = None
    openrouter_model: str = "nvidia/llama-3.1-nemotron-70b-instruct:free"
    frontend_url: str = "*"

    class Config:
        env_file = ".env"


settings = Settings()
