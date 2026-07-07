"""Unit tests (no DB) for demand_signals upsert + holiday record mapping."""

from datetime import date
from decimal import Decimal

from pricepilot.ingest.demand_signals import DemandSignalRecord, demand_signal_row_id
from pricepilot.ingest.holidays import (
    HOLIDAY_SIGNAL_TYPE,
    holiday_signal_records,
    romanian_public_holidays,
    supported_holiday_records,
)


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


def test_holiday_records_cover_every_2026_holiday_as_a_flag() -> None:
    recs = holiday_signal_records("sibiu", 2026)
    holidays = romanian_public_holidays(2026)
    assert len(recs) == len(holidays)
    assert {r.signal_date for r in recs} == set(holidays)
    assert all(r.signal_type == HOLIDAY_SIGNAL_TYPE for r in recs)
    assert all(r.city == "sibiu" for r in recs)
    assert all(r.value == Decimal("1") for r in recs)


def test_supported_holiday_records_skips_unsupported_years() -> None:
    # 2026 supported, 2099 not — result is exactly the 2026 set, no crash.
    recs = supported_holiday_records("sibiu", [2026, 2099])
    assert len(recs) == len(romanian_public_holidays(2026))
    assert {r.signal_date.year for r in recs} == {2026}
