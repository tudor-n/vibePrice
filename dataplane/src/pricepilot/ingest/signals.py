"""Demand-signal records and their idempotent upsert.

Mirrors the events-ingest pattern: every row id is the deterministic uuid5 of
the natural key ``(city, signal_type, signal_date)``, so re-ingesting refreshes
``value``/``source``/``created_at`` in place instead of duplicating rows.
``created_at`` IS refreshed on conflict — for signals it is the freshness
marker (a re-fetched forecast is new data even when the value is unchanged).
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from pricepilot.db.tables import DemandSignal

#: Namespace for deterministic demand_signals row ids (uuid5 of natural keys).
SIGNALS_UUID_NAMESPACE = uuid.uuid5(
    uuid.NAMESPACE_URL, "https://pricepilot.dev/demand-signals"
)


@dataclass(frozen=True)
class SignalRecord:
    """One city-scoped public demand signal for one date."""

    city: str
    signal_type: str
    signal_date: date
    value: Decimal


def signal_row_id(city: str, signal_type: str, signal_date: date) -> UUID:
    """Deterministic demand_signals.id from (city, signal_type, signal_date)."""
    return uuid.uuid5(
        SIGNALS_UUID_NAMESPACE, f"{city}|{signal_type}|{signal_date.isoformat()}"
    )


def upsert_signals(session: Session, records: Sequence[SignalRecord], *, source: str) -> int:
    """Idempotently upsert signal records; returns the number of rows written.

    Does not commit — the caller owns the transaction.
    """
    if not records:
        return 0
    rows = [
        {
            "id": signal_row_id(record.city, record.signal_type, record.signal_date),
            "city": record.city,
            "signal_type": record.signal_type,
            "signal_date": record.signal_date,
            "value": record.value,
            "source": source,
        }
        for record in records
    ]
    statement = pg_insert(DemandSignal).values(rows)
    statement = statement.on_conflict_do_update(
        index_elements=[DemandSignal.id],
        set_={
            "value": statement.excluded.value,
            "source": statement.excluded.source,
            "created_at": func.now(),  # freshness marker: re-ingest = fresh data
        },
    )
    session.execute(statement)
    return len(rows)
