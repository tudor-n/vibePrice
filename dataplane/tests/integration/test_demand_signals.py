"""Integration: demand-signal upserts against the dev DB (weather faked)."""

import json
from pathlib import Path

import pytest
from dbprobe import DATABASE_URL, integration_marks
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.orm import Session

from pricepilot.db.tables import DemandSignal
from pricepilot.scheduler.jobs import handle_ingest_demand_signals

pytestmark = integration_marks()

WEATHER_PAYLOAD = json.loads(
    (Path(__file__).parent.parent / "fixtures" / "open_meteo_sibiu.json").read_text(
        encoding="utf-8"
    )
)
SOURCES = ("python-holidays", "open-meteo")


@pytest.fixture(scope="module")
def engine():
    engine = create_engine(DATABASE_URL)
    yield engine
    engine.dispose()


@pytest.fixture()
def session(engine):
    with Session(engine) as session:
        session.execute(delete(DemandSignal).where(DemandSignal.source.in_(SOURCES)))
        session.commit()
        yield session
        session.rollback()
        session.execute(delete(DemandSignal).where(DemandSignal.source.in_(SOURCES)))
        session.commit()


def _counts(session: Session) -> dict[str, int]:
    rows = session.execute(
        select(DemandSignal.source, func.count())
        .where(DemandSignal.source.in_(SOURCES))
        .group_by(DemandSignal.source)
    ).all()
    return dict(rows)


def test_signals_persist_and_rerun_is_idempotent(session: Session) -> None:
    result = handle_ingest_demand_signals(
        session, {"city": "sibiu"}, weather_http_get=lambda url: WEATHER_PAYLOAD
    )
    session.commit()

    counts = _counts(session)
    assert counts["python-holidays"] == result["holidays_written"] > 0
    assert counts["open-meteo"] == result["weather"] == 6

    first_created = session.execute(
        select(func.max(DemandSignal.created_at)).where(
            DemandSignal.source == "open-meteo"
        )
    ).scalar()

    rerun = handle_ingest_demand_signals(
        session, {"city": "sibiu"}, weather_http_get=lambda url: WEATHER_PAYLOAD
    )
    session.commit()

    assert rerun["signals_written"] == result["signals_written"]
    assert _counts(session) == counts  # upsert: no duplicate rows
    second_created = session.execute(
        select(func.max(DemandSignal.created_at)).where(
            DemandSignal.source == "open-meteo"
        )
    ).scalar()
    assert second_created >= first_created  # created_at is the freshness marker


def test_signal_values_survive_the_decimal_boundary(session: Session) -> None:
    handle_ingest_demand_signals(
        session, {"city": "sibiu"}, weather_http_get=lambda url: WEATHER_PAYLOAD
    )
    session.commit()

    rain = session.execute(
        select(DemandSignal.value)
        .where(DemandSignal.signal_type == "weather.precipitation_mm")
        .order_by(DemandSignal.signal_date)
    ).scalars().all()
    assert [str(value) for value in rain] == ["0.0000", "12.6000", "3.2000"]
