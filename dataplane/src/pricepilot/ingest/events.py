"""Local events calendar ingestion.

v1 ships a static, seeded source for Sibiu so the engine has real events to
reason about from day one.

Persistence is an idempotent upsert into the ``events`` table: the natural key
is ``(city, name, start_date)`` and every row id is the deterministic uuid5 of
that key (:func:`event_row_id`), so re-ingesting the same calendar never
duplicates rows — it refreshes ``end_date`` / ``impact_score`` / ``source`` in
place.

TODO: replace :class:`StaticSibiuEventSource` with real calendar scraping
(sibiu.ro / turism.sibiu.ro event calendars) writing to the ``events`` table.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from uuid import UUID

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from pricepilot.db.tables import Event

#: Namespace for deterministic event row ids (uuid5 of the natural key).
EVENTS_UUID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://pricepilot.dev/events")


@dataclass(frozen=True)
class EventRecord:
    """A city-scoped demand event with a 0-100 impact score."""

    city: str
    name: str
    start_date: date
    end_date: date
    impact_score: int  # 0-100
    id: UUID | None = None  # set once persisted to the `events` table


def event_row_id(city: str, name: str, start_date: date) -> UUID:
    """Deterministic events.id derived from the natural key (city, name, start_date)."""
    return uuid.uuid5(EVENTS_UUID_NAMESPACE, f"{city}|{name}|{start_date.isoformat()}")


def upsert_events(session: Session, records: Sequence[EventRecord], *, source: str) -> int:
    """Idempotently upsert event records; returns the number of rows written.

    Conflict target is the deterministic id (uuid5 of city+name+start_date), so
    a re-run updates ``end_date``/``impact_score``/``source`` in place instead
    of inserting duplicates. ``created_at`` is kept from the first insert.
    Does not commit — the caller owns the transaction.
    """
    if not records:
        return 0
    rows = [
        {
            "id": event_row_id(r.city, r.name, r.start_date),
            "city": r.city,
            "name": r.name,
            "start_date": r.start_date,
            "end_date": r.end_date,
            "impact_score": r.impact_score,
            "source": source,
        }
        for r in records
    ]
    stmt = pg_insert(Event).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[Event.id],
        set_={
            "end_date": stmt.excluded.end_date,
            "impact_score": stmt.excluded.impact_score,
            "source": stmt.excluded.source,
        },
    )
    session.execute(stmt)
    return len(rows)


class StaticSibiuEventSource:
    """Seeded 2026 Sibiu events. TODO: replace with real calendar scraping."""

    city = "sibiu"

    def fetch(self) -> list[EventRecord]:
        return [
            EventRecord(
                city="sibiu",
                name="FITS (Sibiu International Theatre Festival)",
                start_date=date(2026, 6, 12),
                end_date=date(2026, 6, 21),
                impact_score=90,
            ),
            EventRecord(
                city="sibiu",
                name="Sibiu Christmas Market",
                start_date=date(2026, 11, 20),
                end_date=date(2027, 1, 4),
                impact_score=75,
            ),
            EventRecord(
                city="sibiu",
                name="Astra Film Festival",
                start_date=date(2026, 10, 12),
                end_date=date(2026, 10, 18),
                impact_score=60,
            ),
        ]
