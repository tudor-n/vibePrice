"""Weather forecast ingestion from Open-Meteo (free, keyless).

Daily max temperature and precipitation become ``demand_signals`` rows
(``weather.temp_max_c`` / ``weather.precipitation_mm``) so future engine
rules can nudge prices for weather-sensitive dates. Values are quantized to
4dp Decimals (the column is ``numeric(14,4)``); null forecast entries are
skipped per metric.

Tests inject ``http_get`` and use the saved fixture JSON — never the network.
"""

from collections.abc import Callable
from datetime import date
from decimal import Decimal
from typing import Any
from urllib.parse import urlencode

import httpx

from pricepilot.ingest.signals import SignalRecord

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

#: City slug → (latitude, longitude). Extend as cities onboard.
CITY_COORDS: dict[str, tuple[float, float]] = {
    "sibiu": (45.7983, 24.1256),
}

#: Open-Meteo daily metric → our demand_signals signal_type.
_METRIC_SIGNAL_TYPES = {
    "temperature_2m_max": "weather.temp_max_c",
    "precipitation_sum": "weather.precipitation_mm",
}

_FOUR_DP = Decimal("0.0001")


def build_forecast_url(city: str) -> str:
    """Forecast URL for a known city; raises KeyError for unknown cities."""
    latitude, longitude = CITY_COORDS[city]
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "daily": ",".join(_METRIC_SIGNAL_TYPES),
        "forecast_days": 16,
        "timezone": "UTC",
    }
    return f"{OPEN_METEO_URL}?{urlencode(params)}"


def parse_forecast(payload: dict[str, Any], city: str) -> list[SignalRecord]:
    """Turn an Open-Meteo daily payload into signal records (pure)."""
    daily = payload.get("daily") or {}
    days = daily.get("time") or []
    records: list[SignalRecord] = []
    for metric, signal_type in _METRIC_SIGNAL_TYPES.items():
        values = daily.get(metric) or []
        for day_iso, value in zip(days, values, strict=False):
            if value is None:
                continue
            records.append(
                SignalRecord(
                    city=city,
                    signal_type=signal_type,
                    signal_date=date.fromisoformat(day_iso),
                    # str() first: Decimal(float) would drag in binary noise.
                    value=Decimal(str(value)).quantize(_FOUR_DP),
                )
            )
    return records


def _default_http_get(url: str) -> dict[str, Any]:
    response = httpx.get(url, timeout=20.0)
    response.raise_for_status()
    return response.json()


def fetch_weather_signals(
    city: str,
    *,
    http_get: Callable[[str], dict[str, Any]] | None = None,
) -> list[SignalRecord]:
    """Fetch and parse the forecast for a known city.

    Raises KeyError for cities without coordinates — callers decide whether
    that skips weather (the demand-signals handler does) or is an error.
    """
    url = build_forecast_url(city)
    payload = (http_get or _default_http_get)(url)
    return parse_forecast(payload, city)
