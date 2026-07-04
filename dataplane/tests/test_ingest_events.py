"""Unit tests (no DB) for the events upsert natural-key derivation."""

from datetime import date

from pricepilot.ingest.events import StaticSibiuEventSource, event_row_id


def test_event_row_id_is_deterministic() -> None:
    a = event_row_id("sibiu", "FITS", date(2026, 6, 12))
    b = event_row_id("sibiu", "FITS", date(2026, 6, 12))
    assert a == b


def test_event_row_id_varies_with_each_natural_key_part() -> None:
    base = event_row_id("sibiu", "FITS", date(2026, 6, 12))
    assert base != event_row_id("cluj", "FITS", date(2026, 6, 12))  # city
    assert base != event_row_id("sibiu", "Astra", date(2026, 6, 12))  # name
    assert base != event_row_id("sibiu", "FITS", date(2027, 6, 12))  # start_date


def test_static_sibiu_events_derive_unique_ids() -> None:
    records = StaticSibiuEventSource().fetch()
    ids = {event_row_id(r.city, r.name, r.start_date) for r in records}
    assert len(ids) == len(records) == 3
