from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    teable_api_token: str
    teable_base_url: str = "https://app.teable.ai"
    teable_table_id: str = "tbl4fi155DuWlh40By3"
    openrouter_api_key: str
    openrouter_model: str = "mistralai/mistral-7b-instruct:free"
    frontend_url: str = "*"

    class Config:
        env_file = ".env"


settings = Settings()
