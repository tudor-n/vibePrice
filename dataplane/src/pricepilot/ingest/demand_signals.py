"""Demand-signals ingestion: city-scoped public-stats time series.

Persistence mirrors ``ingest.events``: every row id is the deterministic uuid5
of its natural key ``(city, signal_type, signal_date)`` and writes go through a
PostgreSQL ``INSERT ... ON CONFLICT (id) DO UPDATE``, so re-ingesting the same
series refreshes ``value``/``source`` in place and never duplicates rows.

Maps the backend-owned ``demand_signals`` table (``shared/contracts/
table-ownership.md``); never emits DDL. ``demand_signals`` is city-scoped, NOT
tenant-scoped (no tenant filter needed). ``value`` is ``numeric(14,4)`` and is
NOT money (no currency) — e.g. a ``public_holiday`` flag is ``Decimal("1")``.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from pricepilot.db.tables import DemandSignal

#: Namespace for deterministic demand_signals ids (uuid5 of the natural key).
DEMAND_SIGNALS_UUID_NAMESPACE = uuid.uuid5(
    uuid.NAMESPACE_URL, "https://pricepilot.dev/demand-signals"
)


@dataclass(frozen=True)
class DemandSignalRecord:
    """One city-scoped signal point (value is Decimal, not money)."""

    city: str
    signal_type: str
    signal_date: date
    value: Decimal


def demand_signal_row_id(city: str, signal_type: str, signal_date: date) -> UUID:
    """Deterministic demand_signals.id from (city, signal_type, signal_date)."""
    return uuid.uuid5(
        DEMAND_SIGNALS_UUID_NAMESPACE,
        f"{city}|{signal_type}|{signal_date.isoformat()}",
    )


def upsert_demand_signals(
    session: Session, records: Sequence[DemandSignalRecord], *, source: str
) -> int:
    """Idempotently upsert signal records; returns the number of rows written.

    Conflict target is the deterministic id (uuid5 of the natural key), so a
    re-run updates ``value``/``source`` in place. ``created_at`` is kept from
    the first insert. Does not commit — the caller owns the transaction.
    """
    if not records:
        return 0
    rows = [
        {
            "id": demand_signal_row_id(r.city, r.signal_type, r.signal_date),
            "city": r.city,
            "signal_type": r.signal_type,
            "signal_date": r.signal_date,
            "value": r.value,
            "source": source,
        }
        for r in records
    ]
    stmt = pg_insert(DemandSignal).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[DemandSignal.id],
        set_={"value": stmt.excluded.value, "source": stmt.excluded.source},
    )
    session.execute(stmt)
    return len(rows)
