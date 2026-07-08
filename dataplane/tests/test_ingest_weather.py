"""Open-Meteo weather ingestion — fixture JSON only, never the network."""

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from pricepilot.ingest.signals import SignalRecord
from pricepilot.ingest.weather import (
    CITY_COORDS,
    build_forecast_url,
    fetch_weather_signals,
    parse_forecast,
)


@pytest.fixture()
def forecast_payload(fixtures_dir: Path) -> dict:
    return json.loads((fixtures_dir / "open_meteo_sibiu.json").read_text(encoding="utf-8"))


def test_build_forecast_url_exact() -> None:
    assert build_forecast_url("sibiu") == (
        "https://api.open-meteo.com/v1/forecast"
        "?latitude=45.7983&longitude=24.1256"
        "&daily=temperature_2m_max%2Cprecipitation_sum"
        "&forecast_days=16&timezone=UTC"
    )


def test_unknown_city_raises_key_error() -> None:
    with pytest.raises(KeyError):
        build_forecast_url("atlantis")


def test_sibiu_has_coordinates() -> None:
    assert "sibiu" in CITY_COORDS


def test_parse_forecast_yields_decimal_signals_and_skips_nulls(forecast_payload) -> None:
    records = parse_forecast(forecast_payload, "sibiu")

    temp = [r for r in records if r.signal_type == "weather.temp_max_c"]
    rain = [r for r in records if r.signal_type == "weather.precipitation_mm"]

    # 2026-07-10 temp is null, 2026-07-09 precipitation is null → skipped.
    assert [r.signal_date for r in temp] == [
        date(2026, 7, 8),
        date(2026, 7, 9),
        date(2026, 7, 11),
    ]
    assert [r.signal_date for r in rain] == [
        date(2026, 7, 8),
        date(2026, 7, 10),
        date(2026, 7, 11),
    ]
    assert temp[0].value == Decimal("27.4000")
    assert rain[2].value == Decimal("3.2000")
    for record in records:
        assert isinstance(record, SignalRecord)
        assert isinstance(record.value, Decimal)  # numeric(14,4): never float
        assert record.city == "sibiu"


def test_fetch_composes_url_and_parser(forecast_payload) -> None:
    seen: list[str] = []

    def fake_http_get(url: str) -> dict:
        seen.append(url)
        return forecast_payload

    records = fetch_weather_signals("sibiu", http_get=fake_http_get)
    assert seen == [build_forecast_url("sibiu")]
    assert len(records) == 6  # 3 temps + 3 rains from the fixture
