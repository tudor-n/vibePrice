"""12-factor configuration: everything comes from environment variables.

See the repo root ``.env.example`` for documentation of every variable.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Dataplane settings, populated from the environment (12-factor)."""

    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    database_url: str = "postgresql+psycopg://pricepilot:pricepilot@localhost:5432/pricepilot"
    scraper_user_agent: str = "PricePilotBot/0.1"
    scraper_proxy_url: str = ""
    scheduler_enabled: bool = True
    log_level: str = "INFO"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings singleton (lazily built from the env)."""
    return Settings()
