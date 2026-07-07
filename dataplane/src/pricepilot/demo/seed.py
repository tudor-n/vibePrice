"""Demo seeder for dataplane-owned tables: ``python -m pricepilot.demo.seed``.

Seeds the world defined by ``shared/contracts/demo-seed.md``:

* ``events`` for sibiu via :class:`~pricepilot.ingest.events.StaticSibiuEventSource`
  (the Task-1 upsert, ``source='static_sibiu'``);
* ``scraped_rates`` for the three fixed demo competitors for the next
  ``SEED_DAYS`` (120) stay dates from today — plausible Sibiu prices with
  weekend bumps and event-aware bumps (+10-20% scaled by impact score);
* exactly one succeeded ``scrape_runs`` row with ``source='demo'``.

Idempotency strategy (documented per contract): every row id is a
deterministic uuid5 of its natural key — ``scraped_rates`` from
``(competitor_id, stay_date)`` (:func:`rate_row_id`), ``events`` from
``(city, name, start_date)``, and the scrape run from the fixed literal
``"demo"`` — and all writes are PostgreSQL upserts
(``INSERT ... ON CONFLICT (id) DO UPDATE``). Re-running refreshes rows in
place and never duplicates them.

Prices are ``Decimal`` end-to-end. Randomness is seeded per
``(competitor_id, stay_date)``, so reruns are deterministic for a given stay
date even when run on a different day (the 120-day window just slides).

**Dev/demo only. Never run against production data.** The backend-owned rows
(tenant, property, room types, competitors) come from the backend seeder
(``Demo__SeedOnStartup=true``); this module refuses to seed rates when the
demo competitors are missing.
"""

import logging
import random
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from pricepilot.db.session import session_scope
from pricepilot.db.tables import Competitor, ScrapedRate, ScrapeRun
from pricepilot.ingest.events import EventRecord, StaticSibiuEventSource, upsert_events
from pricepilot.ingest.holidays import ingest_holidays

logger = logging.getLogger(__name__)

#: Namespace for deterministic demo-seed row ids (uuid5 of natural keys).
DEMO_SEED_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://pricepilot.dev/demo-seed")

#: How many stay dates to seed, starting from today.
SEED_DAYS = 120

CURRENCY = "RON"
SCRAPE_RUN_SOURCE = "demo"
EVENTS_SOURCE = "static_sibiu"

_TWO_DP = Decimal("0.01")
_ONE_HUNDRED = Decimal("100")


@dataclass(frozen=True)
class CompetitorProfile:
    """Fixed demo competitor (UUIDs from ``shared/contracts/demo-seed.md``)."""

    competitor_id: UUID
    name: str
    min_price: int  # whole RON
    max_price: int  # whole RON


COMPETITOR_PROFILES: list[CompetitorProfile] = [
    CompetitorProfile(
        UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), "Hotel Ramada Sibiu", 380, 450
    ),
    CompetitorProfile(
        UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), "Hotel Împăratul Romanilor", 330, 400
    ),
    CompetitorProfile(
        UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc"), "Casa Luxemburg", 300, 370
    ),
]

#: Deterministic id of the single demo scrape_runs row.
DEMO_SCRAPE_RUN_ID = uuid.uuid5(DEMO_SEED_NAMESPACE, "scrape_run|demo")


def rate_row_id(competitor_id: UUID, stay_date: date) -> UUID:
    """Deterministic scraped_rates.id from the natural key (competitor_id, stay_date)."""
    return uuid.uuid5(DEMO_SEED_NAMESPACE, f"scraped_rate|{competitor_id}|{stay_date.isoformat()}")


def event_bump_pct(events: list[EventRecord], stay_date: date) -> Decimal:
    """+10-20% for stay dates overlapping an event, scaled by the strongest impact score."""
    overlapping = [e for e in events if e.start_date <= stay_date <= e.end_date]
    if not overlapping:
        return Decimal("0")
    top = max(e.impact_score for e in overlapping)
    return Decimal("10") + Decimal(top) / Decimal("10")  # impact 0-100 -> +10.0% .. +20.0%


def price_for(profile: CompetitorProfile, stay_date: date, events: list[EventRecord]) -> Decimal:
    """Plausible demo price as a 2dp Decimal; deterministic per (competitor, stay date).

    The RNG is seeded from the natural key, so re-seeding (any day) always
    produces the same price for the same competitor and stay date.
    """
    rng = random.Random(f"demo-rates|{profile.competitor_id}|{stay_date.isoformat()}")
    base = Decimal(rng.randint(profile.min_price, profile.max_price))

    bump_pct = Decimal("0")
    if stay_date.weekday() in (4, 5):  # Friday/Saturday nights
        bump_pct += Decimal(rng.randint(8, 15))
    bump_pct += event_bump_pct(events, stay_date)

    price = base * (Decimal("1") + bump_pct / _ONE_HUNDRED)
    return price.quantize(_TWO_DP, rounding=ROUND_HALF_UP)


def _missing_competitors(session: Session) -> list[CompetitorProfile]:
    ids = [p.competitor_id for p in COMPETITOR_PROFILES]
    present = set(session.execute(select(Competitor.id).where(Competitor.id.in_(ids))).scalars())
    return [p for p in COMPETITOR_PROFILES if p.competitor_id not in present]


def seed(session: Session, *, today: date | None = None) -> dict[str, Any]:
    """Seed events, scraped_rates and one succeeded scrape_run. Idempotent.

    Does not commit — the caller owns the transaction
    (``python -m pricepilot.demo.seed`` commits via ``session_scope``).
    """
    today = today or date.today()

    # 1. Events (Task-1 upsert; same rows the ingest.events job writes).
    records = StaticSibiuEventSource().fetch()
    events_written = upsert_events(session, records, source=EVENTS_SOURCE)

    # 2. Competitor rates — require the backend-seeded competitor rows (FK).
    missing = _missing_competitors(session)
    if missing:
        names = ", ".join(f"{p.name} ({p.competitor_id})" for p in missing)
        raise RuntimeError(
            "Demo competitors missing from the database: "
            f"{names}. Run the backend demo seeder first "
            "(backend-owned tables, see shared/contracts/demo-seed.md)."
        )

    captured_at = datetime.now(UTC)
    rate_rows = [
        {
            "id": rate_row_id(profile.competitor_id, stay_date),
            "competitor_id": profile.competitor_id,
            "stay_date": stay_date,
            "price": price_for(profile, stay_date, records),
            "currency": CURRENCY,
            "captured_at": captured_at,
        }
        for profile in COMPETITOR_PROFILES
        for stay_date in (today + timedelta(days=offset) for offset in range(SEED_DAYS))
    ]
    rates_stmt = pg_insert(ScrapedRate).values(rate_rows)
    rates_stmt = rates_stmt.on_conflict_do_update(
        index_elements=[ScrapedRate.id],
        set_={
            "price": rates_stmt.excluded.price,
            "currency": rates_stmt.excluded.currency,
            "captured_at": rates_stmt.excluded.captured_at,
        },
    )
    session.execute(rates_stmt)

    # 3. One succeeded scrape_run (fixed deterministic id -> stays one row).
    run_stmt = pg_insert(ScrapeRun).values(
        id=DEMO_SCRAPE_RUN_ID,
        source=SCRAPE_RUN_SOURCE,
        status="succeeded",
        started_at=captured_at,
        finished_at=captured_at,
        error=None,
    )
    run_stmt = run_stmt.on_conflict_do_update(
        index_elements=[ScrapeRun.id],
        set_={
            "status": run_stmt.excluded.status,
            "started_at": run_stmt.excluded.started_at,
            "finished_at": run_stmt.excluded.finished_at,
            "error": run_stmt.excluded.error,
        },
    )
    session.execute(run_stmt)

    # 4. Public-holiday demand signals for sibiu (idempotent uuid5 upsert; the
    #    same rows the ingest.demand_signals job writes).
    demand_signals_written = ingest_holidays(session, city="sibiu", today=today)

    return {
        "events_written": events_written,
        "scraped_rates_written": len(rate_rows),
        "demand_signals_written": demand_signals_written,
        "scrape_run_id": str(DEMO_SCRAPE_RUN_ID),
        "first_stay_date": today.isoformat(),
        "last_stay_date": (today + timedelta(days=SEED_DAYS - 1)).isoformat(),
    }


def main() -> None:
    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    with session_scope() as session:
        summary = seed(session)
    logger.info("Demo seed complete: %s", summary)


if __name__ == "__main__":
    main()
