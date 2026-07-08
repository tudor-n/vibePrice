"""ingest.demand_signals handler wiring — fake session + fixture weather."""

import json
from pathlib import Path

from pricepilot.scheduler.jobs import handle_ingest_demand_signals


class RecordingSession:
    """Captures executed statements; upsert compilation happens later in SQLA."""

    def __init__(self) -> None:
        self.statements: list[object] = []

    def execute(self, statement, *args, **kwargs):
        self.statements.append(statement)


def load_weather_payload() -> dict:
    fixture = Path(__file__).parent / "fixtures" / "open_meteo_sibiu.json"
    return json.loads(fixture.read_text(encoding="utf-8"))


def test_sibiu_ingests_holidays_and_weather() -> None:
    session = RecordingSession()
    calls: list[str] = []

    def fake_http_get(url: str) -> dict:
        calls.append(url)
        return load_weather_payload()

    result = handle_ingest_demand_signals(
        session, {"city": "sibiu"}, weather_http_get=fake_http_get
    )

    assert len(calls) == 1
    assert result["city"] == "sibiu"
    assert result["holidays_written"] > 0  # ~11 RO holidays in any 365-day window
    assert result["weather"] == 6  # fixture: 3 temps + 3 rains
    assert result["signals_written"] == result["holidays_written"] + 6
    assert len(session.statements) == 2  # one upsert per source


def test_city_without_coordinates_skips_weather() -> None:
    session = RecordingSession()

    def must_not_be_called(url: str) -> dict:  # pragma: no cover - failure path
        raise AssertionError("weather must not be fetched without coordinates")

    result = handle_ingest_demand_signals(
        session, {"city": "brasov"}, weather_http_get=must_not_be_called
    )

    assert result["weather"] == "skipped: no coordinates for city"
    assert result["holidays_written"] > 0
    assert result["signals_written"] == result["holidays_written"]
    assert len(session.statements) == 1  # holidays only


def test_city_defaults_to_sibiu_and_is_normalized() -> None:
    session = RecordingSession()
    result = handle_ingest_demand_signals(
        session, {"city": "  SIBIU "}, weather_http_get=lambda url: load_weather_payload()
    )
    assert result["city"] == "sibiu"
