"""Mapping-drift guards: ``db/tables.py`` must match the backend EF migration.

``db/tables.py`` only *maps* the backend-owned schema (it never emits DDL), so
a column that is missing, extra, or the wrong length surfaces as a runtime
query failure instead of a test failure. These assertions pin the mappings to
``backend/src/PricePilot.Infrastructure/Migrations/20260704082536_InitialCreate.cs``
for the columns that have drifted before.
"""

from sqlalchemy import String

from pricepilot.db.tables import Event, OwnBooking

# Exact column set of own_bookings in the EF migration (no created_at there).
OWN_BOOKINGS_MIGRATED_COLUMNS = {
    "id",
    "tenant_id",
    "property_id",
    "room_type_id",
    "stay_date",
    "price",
    "currency",
    "booked_at",
    "source",
}


def test_own_bookings_maps_exactly_the_migrated_columns() -> None:
    assert set(OwnBooking.__table__.columns.keys()) == OWN_BOOKINGS_MIGRATED_COLUMNS


def test_own_bookings_source_is_not_null_varchar_100() -> None:
    source = OwnBooking.__table__.c.source
    assert isinstance(source.type, String)
    assert source.type.length == 100
    assert source.nullable is False


def test_event_name_length_matches_migration_varchar_300() -> None:
    name = Event.__table__.c.name
    assert isinstance(name.type, String)
    assert name.type.length == 300
    assert name.nullable is False
