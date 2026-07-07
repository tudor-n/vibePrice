"""Integration: holidays ingestion writes idempotent demand_signals rows.

Runs against the EF-migrated dev/CI database. demand_signals has no FKs, so this
needs no backend demo seed — only the migrated schema.
"""

from datetime import date

from dbprobe import DATABASE_URL, integration_marks
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.orm import Session

from pricepilot.db.tables import DemandSignal
from pricepilot.ingest.holidays import (
    HOLIDAY_SIGNAL_TYPE,
    ingest_holidays,
    romanian_public_holidays,
)

pytestmark = integration_marks()

_TEST_CITY = "sibiu"


def _session() -> Session:
    return Session(create_engine(DATABASE_URL))


def _holiday_count(session: Session, year: int) -> int:
    return session.execute(
        select(func.count()).where(
            DemandSignal.city == _TEST_CITY,
            DemandSignal.signal_type == HOLIDAY_SIGNAL_TYPE,
            func.extract("year", DemandSignal.signal_date) == year,
        )
    ).scalar_one()


def test_ingest_holidays_is_idempotent() -> None:
    session = _session()
    try:
        # Isolate from any prior run of this test.
        session.execute(
            delete(DemandSignal).where(
                DemandSignal.city == _TEST_CITY,
                DemandSignal.signal_type == HOLIDAY_SIGNAL_TYPE,
            )
        )
        session.commit()

        expected_2026 = len(romanian_public_holidays(2026))
        today = date(2026, 1, 15)

        first = ingest_holidays(session, city=_TEST_CITY, today=today)
        session.commit()
        second = ingest_holidays(session, city=_TEST_CITY, today=today)
        session.commit()

        assert first == second  # same rows both runs
        assert _holiday_count(session, 2026) == expected_2026  # upsert: no duplicates

        row = session.execute(
            select(DemandSignal)
            .where(
                DemandSignal.city == _TEST_CITY,
                DemandSignal.signal_type == HOLIDAY_SIGNAL_TYPE,
            )
            .limit(1)
        ).scalar_one()
        assert str(row.value) in ("1", "1.0000")  # numeric(14,4) flag
        assert row.source == "holidays"
    finally:
        session.close()
