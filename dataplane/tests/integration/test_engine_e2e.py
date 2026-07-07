"""End-to-end integration tests: demo seed -> engine job -> recommendations rows.

Marked ``integration`` and skipped automatically when the dev database is
unreachable (2s connect timeout) or the backend EF migrations have not been
applied. Setup:

    docker compose up -d db           # repo root
    cd backend && dotnet tool restore && dotnet tool run dotnet-ef database update \
        --project src/PricePilot.Infrastructure --startup-project src/PricePilot.Api \
        --connection "Host=localhost;Port=5432;Database=pricepilot;\
                      Username=pricepilot;Password=devpassword"

The backend-owned demo rows (tenant/property/room types/competitors) are
inserted by a test fixture below as a stand-in for the backend demo seeder
(``Demo__SeedOnStartup=true``, not implemented yet) using the fixed UUIDs from
``shared/contracts/demo-seed.md``. That write happens only in this dev-DB test
fixture — runtime dataplane code never writes backend-owned tables.
"""

import os
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import create_engine, func, select, text, update
from sqlalchemy.orm import Session

from pricepilot.db.tables import Event, Recommendation, ScrapedRate, ScrapeRun
from pricepilot.demo.seed import COMPETITOR_PROFILES, SEED_DAYS, seed
from pricepilot.scheduler.jobs import handle_generate_recommendations

DEFAULT_DATABASE_URL = "postgresql+psycopg://pricepilot:devpassword@localhost:5432/pricepilot"
DATABASE_URL = os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)

# Fixed demo UUIDs — shared/contracts/demo-seed.md.
TENANT_ID = UUID("11111111-1111-4111-8111-111111111111")
PROPERTY_ID = UUID("33333333-3333-4333-8333-333333333333")
ROOM_DOUBLE_ID = UUID("44444444-4444-4444-8444-444444444444")
ROOM_APARTMENT_ID = UUID("55555555-5555-4555-8555-555555555555")

HORIZON_DAYS = 90
ENGINE_PAYLOAD: dict[str, Any] = {
    "tenant_id": str(TENANT_ID),
    "property_id": None,
    "horizon_days": HORIZON_DAYS,
}
EXPECTED_RULES = ["seasonality", "event_impact", "competitor_position", "day_of_week", "lead_time"]


def _db_ready() -> tuple[bool, str]:
    try:
        probe = create_engine(DATABASE_URL, connect_args={"connect_timeout": 2})
        try:
            with probe.connect() as conn:
                has_schema = conn.execute(text("SELECT to_regclass('recommendations')")).scalar()
            if has_schema is None:
                return False, "schema missing — apply the backend EF migrations"
            return True, ""
        finally:
            probe.dispose()
    except Exception as exc:  # noqa: BLE001 - any connection failure means skip
        return False, str(exc)


_READY, _SKIP_REASON = _db_ready()

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not _READY, reason=f"integration database unavailable: {_SKIP_REASON}"),
]

# Stand-in for the backend demo seeder (dev DB test fixture only — see module docstring).
_BACKEND_DEMO_ROWS_SQL = [
    """
    INSERT INTO tenants (id, name, subscription_plan, subscription_status, created_at)
    VALUES ('11111111-1111-4111-8111-111111111111', 'Pensiunea Demo SRL', 'demo', 'active', now())
    ON CONFLICT (id) DO NOTHING
    """,
    """
    INSERT INTO properties (id, tenant_id, name, city, address, created_at)
    VALUES ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111',
            'Pensiunea Piața Mică', 'sibiu', NULL, now())
    ON CONFLICT (id) DO NOTHING
    """,
    """
    INSERT INTO room_types
        (id, tenant_id, property_id, name, capacity, base_price, current_price, currency)
    VALUES
        ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111',
         '33333333-3333-4333-8333-333333333333', 'Cameră dublă', 2, 350.00, 350.00, 'RON'),
        ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111',
         '33333333-3333-4333-8333-333333333333', 'Apartament', 4, 520.00, 520.00, 'RON')
    ON CONFLICT (id) DO NOTHING
    """,
    """
    INSERT INTO competitors (id, tenant_id, property_id, name, source_url, created_at)
    VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111',
         '33333333-3333-4333-8333-333333333333', 'Hotel Ramada Sibiu',
         'https://example.test/ramada-sibiu', now()),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111',
         '33333333-3333-4333-8333-333333333333', 'Hotel Împăratul Romanilor',
         'https://example.test/imparatul-romanilor', now()),
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111',
         '33333333-3333-4333-8333-333333333333', 'Casa Luxemburg',
         'https://example.test/casa-luxemburg', now())
    ON CONFLICT (id) DO NOTHING
    """,
]


@pytest.fixture(scope="module")
def engine():
    engine = create_engine(DATABASE_URL)
    yield engine
    engine.dispose()


@pytest.fixture(scope="module")
def demo_world(engine):
    """Backend-owned demo rows + a clean recommendations slate for the tenant."""
    with Session(engine) as session:
        for statement in _BACKEND_DEMO_ROWS_SQL:
            session.execute(text(statement))
        # Reset engine output so decided rows from earlier runs don't leak in.
        session.execute(
            text("DELETE FROM recommendations WHERE tenant_id = :tenant"),
            {"tenant": TENANT_ID},
        )
        session.commit()


@pytest.fixture()
def session(engine, demo_world):
    with Session(engine) as session:
        yield session
        session.rollback()


def _pending_keys(session: Session) -> list[tuple[UUID, date]]:
    return list(
        session.execute(
            select(Recommendation.room_type_id, Recommendation.stay_date).where(
                Recommendation.tenant_id == TENANT_ID, Recommendation.status == "pending"
            )
        ).all()
    )


def test_demo_seed_is_idempotent(session: Session) -> None:
    first = seed(session)
    session.commit()
    second = seed(session)
    session.commit()
    assert first["scraped_rates_written"] == second["scraped_rates_written"] == 3 * SEED_DAYS

    competitor_ids = [p.competitor_id for p in COMPETITOR_PROFILES]
    rate_count = session.execute(
        select(func.count()).where(ScrapedRate.competitor_id.in_(competitor_ids))
    ).scalar()
    assert rate_count == 3 * SEED_DAYS  # upsert on deterministic ids: no duplicates

    runs = session.execute(select(ScrapeRun).where(ScrapeRun.source == "demo")).scalars().all()
    assert len(runs) == 1
    assert runs[0].status == "succeeded"

    events = session.execute(select(Event).where(Event.source == "static_sibiu")).scalars().all()
    assert len(events) == 3


def test_generate_recommendations_end_to_end(session: Session) -> None:
    seed(session)
    session.commit()

    result = handle_generate_recommendations(session, ENGINE_PAYLOAD)
    session.commit()
    assert result == {"generated": 2 * HORIZON_DAYS, "skipped": 0}

    for room_type_id in (ROOM_DOUBLE_ID, ROOM_APARTMENT_ID):
        count = session.execute(
            select(func.count()).where(
                Recommendation.room_type_id == room_type_id,
                Recommendation.status == "pending",
            )
        ).scalar()
        assert count == HORIZON_DAYS

    # Prices are whole RON across the board (RON rounds DOWN to whole units).
    fractional = session.execute(
        select(func.count()).where(
            Recommendation.tenant_id == TENANT_ID,
            Recommendation.recommended_price % 1 != 0,
        )
    ).scalar()
    assert fractional == 0

    # Factors payload shape per shared/contracts/recommendation-factors.md.
    row = session.execute(
        select(Recommendation)
        .where(Recommendation.room_type_id == ROOM_DOUBLE_ID)
        .order_by(Recommendation.stay_date)
        .limit(1)
    ).scalar_one()
    factors_payload = row.factors
    for key in (
        "engine_version",
        "base_price",
        "currency",
        "factors",
        "recommended_price",
        "expected_impact",
        "data_freshness",
    ):
        assert key in factors_payload, f"missing top-level key {key}"
    assert [f["rule"] for f in factors_payload["factors"]] == EXPECTED_RULES
    for factor in factors_payload["factors"]:
        assert set(factor) >= {"rule", "adjustment_pct", "reason"}
        assert isinstance(factor["reason"], str) and factor["reason"]
    competitor_factor = factors_payload["factors"][2]
    assert competitor_factor["sample_size"] == 3  # all three seeded competitors
    assert factors_payload["currency"] == "RON"
    assert Decimal(str(factors_payload["recommended_price"])) == row.recommended_price
    assert factors_payload["data_freshness"]["scraped_rates_at"] is not None
    assert factors_payload["data_freshness"]["events_at"] is not None
    impact = factors_payload["expected_impact"]
    assert set(impact) == {"estimate", "currency", "period_start", "period_end", "method"}
    assert Decimal(str(impact["estimate"])) == row.expected_impact


def test_rerun_replaces_pending_without_duplicates(session: Session) -> None:
    seed(session)
    session.commit()
    handle_generate_recommendations(session, ENGINE_PAYLOAD)
    session.commit()
    first_keys = _pending_keys(session)

    result = handle_generate_recommendations(session, ENGINE_PAYLOAD)
    session.commit()
    second_keys = _pending_keys(session)

    assert result["generated"] == 2 * HORIZON_DAYS
    assert sorted(second_keys) == sorted(first_keys)
    assert len(second_keys) == len(set(second_keys)), "duplicate pending (room_type, stay_date)"


def _past_recommendation(status: str, *, days_ago: int) -> Recommendation:
    """A recommendation whose stay date has already passed (purge-test rows)."""
    return Recommendation(
        tenant_id=TENANT_ID,
        property_id=PROPERTY_ID,
        room_type_id=ROOM_DOUBLE_ID,
        stay_date=date.today() - timedelta(days=days_ago),
        current_price=Decimal("350.00"),
        recommended_price=Decimal("360.00"),
        currency="RON",
        expected_impact=Decimal("7.00"),
        factors={"note": "past-dated row for purge test"},
        status=status,
        decided_at=None if status == "pending" else datetime.now(UTC),
    )


def test_rerun_purges_past_pending_but_never_past_decisions(session: Session) -> None:
    # Clean slate for this tenant: earlier tests in the module leave decided rows.
    session.execute(
        text("DELETE FROM recommendations WHERE tenant_id = :tenant"), {"tenant": TENANT_ID}
    )
    seed(session)
    session.commit()

    stale_pending = _past_recommendation("pending", days_ago=3)
    past_dismissed = _past_recommendation("dismissed", days_ago=2)
    session.add_all([stale_pending, past_dismissed])
    session.commit()
    stale_pending_id, past_dismissed_id = stale_pending.id, past_dismissed.id

    result = handle_generate_recommendations(session, ENGINE_PAYLOAD)
    session.commit()
    session.expire_all()

    assert session.get(Recommendation, stale_pending_id) is None, (
        "past-dated pending row survived the re-run — stale pending rows accumulate"
    )
    survivor = session.get(Recommendation, past_dismissed_id)
    assert survivor is not None, "decided (dismissed) row was deleted — decisions must survive"
    assert survivor.status == "dismissed"
    # Past rows are outside the horizon: they never affect generated/skipped counts.
    assert result == {"generated": 2 * HORIZON_DAYS, "skipped": 0}
    assert len(_pending_keys(session)) == 2 * HORIZON_DAYS


def test_accepted_rows_survive_reruns_untouched(session: Session) -> None:
    seed(session)
    session.commit()
    handle_generate_recommendations(session, ENGINE_PAYLOAD)
    session.commit()

    accepted = session.execute(
        select(Recommendation)
        .where(Recommendation.tenant_id == TENANT_ID, Recommendation.status == "pending")
        .order_by(Recommendation.stay_date, Recommendation.room_type_id)
        .limit(1)
    ).scalar_one()
    accepted_id, accepted_price = accepted.id, accepted.recommended_price
    accepted_key = (accepted.room_type_id, accepted.stay_date)
    session.execute(
        update(Recommendation)
        .where(Recommendation.id == accepted_id)
        .values(status="accepted", decided_at=datetime.now(UTC))
    )
    session.commit()

    result = handle_generate_recommendations(session, ENGINE_PAYLOAD)
    session.commit()
    session.expire_all()

    survivor = session.get(Recommendation, accepted_id)
    assert survivor is not None, "accepted row was deleted by a re-run"
    assert survivor.status == "accepted"
    assert survivor.recommended_price == accepted_price
    assert result["skipped"] == 1
    assert result["generated"] == 2 * HORIZON_DAYS - 1
    # No fresh pending row shadows the accepted decision.
    assert accepted_key not in _pending_keys(session)
    # Everything else is still covered.
    assert len(_pending_keys(session)) == 2 * HORIZON_DAYS - 1
