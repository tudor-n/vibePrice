"""Demand-signal records and their deterministic row identity."""

from datetime import date
from decimal import Decimal

from pricepilot.ingest.signals import SignalRecord, signal_row_id


def test_signal_row_id_is_deterministic_on_the_natural_key() -> None:
    first = signal_row_id("sibiu", "public_holiday", date(2026, 12, 1))
    second = signal_row_id("sibiu", "public_holiday", date(2026, 12, 1))
    assert first == second


def test_signal_row_id_differs_across_key_parts() -> None:
    base = signal_row_id("sibiu", "public_holiday", date(2026, 12, 1))
    assert base != signal_row_id("brasov", "public_holiday", date(2026, 12, 1))
    assert base != signal_row_id("sibiu", "weather.temp_max_c", date(2026, 12, 1))
    assert base != signal_row_id("sibiu", "public_holiday", date(2026, 12, 2))


def test_signal_record_is_frozen_and_decimal_valued() -> None:
    record = SignalRecord(
        city="sibiu",
        signal_type="weather.precipitation_mm",
        signal_date=date(2026, 7, 9),
        value=Decimal("3.2000"),
    )
    assert isinstance(record.value, Decimal)
