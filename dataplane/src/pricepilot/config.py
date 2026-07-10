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

    # Scraping (ADR 0004): city-search pages, one request per stay date.
    scrape_sources: str = "booking"
    scrape_days_ahead: int = 90
    scrape_delay_seconds: float = 4.0
    scrape_timeout_seconds: float = 20.0
    scrape_currency: str = "RON"

    # Places (Google Places API): property/competitor geocoding + auto-discovery.
    places_provider: str = "fixture"        # "google" | "fixture"
    google_places_api_key: str = ""
    competitor_discovery_radius_m: int = 1500
    competitor_discovery_max: int = 15
    # Competitor→Booking linking + scrape coverage.
    competitor_link_max_results: int = 10   # cards considered per link search

    def scrape_source_list(self) -> list[str]:
        """Enabled scraper names, parsed from the comma-separated env value."""
        return [name.strip() for name in self.scrape_sources.split(",") if name.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings singleton (lazily built from the env)."""
    return Settings()
