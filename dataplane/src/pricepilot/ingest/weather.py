"""Weather forecast ingestion.

Will pull daily forecasts (temperature, precipitation) for a city from the
free open-meteo API (https://open-meteo.com/) and write them into
``demand_signals`` (source="weather", metric e.g. "precipitation_mm"), so a
future engine rule can nudge prices for weather-sensitive dates.

Not implemented in v1 scaffolding.
"""

from datetime import date
from decimal import Decimal


def fetch_daily_forecast(city: str, start: date, end: date) -> dict[date, dict[str, Decimal]]:
    """Fetch a daily weather forecast for a city from open-meteo."""
    raise NotImplementedError(
        "Weather ingestion is not implemented yet; will query open-meteo and "
        "persist rows into demand_signals."
    )
