"""Unit tests (no DB) for the demand_signals upsert natural-key derivation."""

from datetime import date
from decimal import Decimal

from pricepilot.ingest.demand_signals import DemandSignalRecord, demand_signal_row_id


def test_row_id_is_deterministic() -> None:
    a = demand_signal_row_id("sibiu", "public_holiday", date(2026, 12, 1))
    b = demand_signal_row_id("sibiu", "public_holiday", date(2026, 12, 1))
    assert a == b


def test_row_id_varies_with_each_natural_key_part() -> None:
    base = demand_signal_row_id("sibiu", "public_holiday", date(2026, 12, 1))
    assert base != demand_signal_row_id("cluj", "public_holiday", date(2026, 12, 1))  # city
    assert base != demand_signal_row_id("sibiu", "weather", date(2026, 12, 1))  # signal_type
    assert base != demand_signal_row_id("sibiu", "public_holiday", date(2027, 12, 1))  # date


def test_record_holds_decimal_value() -> None:
    rec = DemandSignalRecord("sibiu", "public_holiday", date(2026, 12, 1), Decimal("1"))
    assert isinstance(rec.value, Decimal)
