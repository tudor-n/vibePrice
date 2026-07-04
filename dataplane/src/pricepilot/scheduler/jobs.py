"""Jobs-table claiming and handlers (contract: ``shared/contracts/jobs.md``).

Claiming is atomic so multiple workers never double-claim: Postgres does not
allow ``LIMIT`` directly in ``UPDATE``, so the claim uses a subquery with
``FOR UPDATE SKIP LOCKED`` and ``RETURNING``. Handlers must be idempotent —
re-running a succeeded job is always safe.
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, insert, select, text, update
from sqlalchemy.orm import Session

from pricepilot.db.tables import (
    Competitor,
    Event,
    Job,
    Property,
    Recommendation,
    RoomType,
    ScrapedRate,
    ScrapeRun,
)
from pricepilot.engine.explainer import build_factors_payload
from pricepilot.engine.models import RuleContext
from pricepilot.engine.pipeline import compute
from pricepilot.engine.serialization import to_jsonable
from pricepilot.ingest.events import EventRecord, StaticSibiuEventSource, upsert_events

logger = logging.getLogger(__name__)

_CLAIM_SQL = text(
    """
    UPDATE jobs
       SET status = 'running',
           started_at = now()
     WHERE id = (
            SELECT id
              FROM jobs
             WHERE status = 'queued'
             ORDER BY created_at
             LIMIT 1
               FOR UPDATE SKIP LOCKED
           )
    RETURNING id, type, payload
    """
)


@dataclass(frozen=True)
class ClaimedJob:
    id: UUID
    type: str
    payload: dict[str, Any]


def claim_next_job(session: Session) -> ClaimedJob | None:
    """Atomically claim the oldest queued job, or return None when idle.

    Commits immediately so the ``running`` status is visible (and the row lock
    released) before the handler starts.
    """
    row = session.execute(_CLAIM_SQL).one_or_none()
    session.commit()
    if row is None:
        return None
    return ClaimedJob(id=row.id, type=row.type, payload=row.payload or {})


def finish_job(
    session: Session,
    job_id: UUID,
    *,
    status: str,
    result: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    """Mark a claimed job ``succeeded`` or ``failed`` with its result/error."""
    if status not in ("succeeded", "failed"):
        raise ValueError(f"finish_job status must be 'succeeded' or 'failed', got {status!r}")
    session.execute(
        update(Job)
        .where(Job.id == job_id)
        .values(status=status, result=result, error=error, finished_at=func.now())
    )
    session.commit()


def enqueue_job(session: Session, job_type: str, payload: dict[str, Any]) -> None:
    """Insert a queued job (used by the internal APScheduler cron enqueues)."""
    session.execute(insert(Job).values(type=job_type, payload=payload, status="queued"))
    session.commit()


# --------------------------------------------------------------------------
# Handlers — one per job type in shared/contracts/jobs.md
# --------------------------------------------------------------------------


def handle_scrape_competitor_rates(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    """Scrape OTA rates for competitors of one property (or a whole city)."""
    logger.info("scrape.competitor_rates stub: payload=%s", payload)
    # TODO: look up competitors (by property_id or city), dispatch to
    # pricepilot.scrapers.SCRAPERS by source, record a scrape_runs row,
    # and upsert scraped_rates. Idempotent: re-scraping just refreshes rows.
    return {"note": "stub — no scraping performed", "rates_written": 0}


def handle_ingest_events(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    """Refresh the events calendar for a city.

    v1 source is :class:`StaticSibiuEventSource`; the upsert is idempotent on
    the natural key (city, name, start_date) — see ``pricepilot.ingest.events``.
    """
    city = (payload.get("city") or "sibiu").lower()
    records = [r for r in StaticSibiuEventSource().fetch() if r.city == city]
    written = upsert_events(session, records, source="static_sibiu")
    logger.info("ingest.events: city=%s events_written=%d", city, written)
    return {"city": city, "events_written": written}


def handle_ingest_demand_signals(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    """Refresh public stats/holidays/weather signals for a city."""
    logger.info("ingest.demand_signals stub: payload=%s", payload)
    # TODO: run ingest.holidays / ingest.tourism_stats / ingest.weather and
    # upsert into demand_signals.
    return {"note": "stub — no signals ingested", "signals_written": 0}


@dataclass(frozen=True)
class RecommendationInput:
    """One engine work item: the RuleContext plus the ids needed to persist it."""

    tenant_id: UUID
    property_id: UUID
    room_type_id: UUID
    ctx: RuleContext


def _load_rule_contexts(
    session: Session,
    *,
    tenant_id: UUID | None = None,
    property_id: UUID | None = None,
    horizon_days: int = 90,
    today: date | None = None,
) -> list[RecommendationInput]:
    """Load one work item per (room type, stay date) for today..today+horizon.

    ``tenant_id=None`` / ``property_id=None`` mean "all": this is the system
    job dispatched via the jobs table (``shared/contracts/jobs.md`` — nulls
    mean all), not a user-facing query path. When a scope IS given, every
    query here is bound to it (tenant isolation hard rule); results only ever
    reach the ``recommendations`` table, which carries ``tenant_id`` per row.
    """
    today = today or date.today()
    horizon_end = today + timedelta(days=horizon_days)  # exclusive
    stay_dates = [today + timedelta(days=offset) for offset in range(horizon_days)]

    room_query = select(RoomType, Property.city).join(
        Property, RoomType.property_id == Property.id
    )
    if tenant_id is not None:
        room_query = room_query.where(RoomType.tenant_id == tenant_id)
    if property_id is not None:
        room_query = room_query.where(RoomType.property_id == property_id)
    room_rows = session.execute(room_query).all()
    if not room_rows:
        return []

    cities = {city for _, city in room_rows}
    property_ids = {room_type.property_id for room_type, _ in room_rows}

    # Events per city overlapping the horizon.
    events_by_city: dict[str, list[EventRecord]] = {city: [] for city in cities}
    event_rows = (
        session.execute(
            select(Event).where(
                Event.city.in_(cities),
                Event.end_date >= today,
                Event.start_date < horizon_end,
            )
        )
        .scalars()
        .all()
    )
    for event in event_rows:
        events_by_city[event.city].append(
            EventRecord(
                city=event.city,
                name=event.name,
                start_date=event.start_date,
                end_date=event.end_date,
                impact_score=event.impact_score,
                id=event.id,
            )
        )

    # Events data freshness: latest ingest per city, regardless of whether any
    # event happens to overlap the horizon (no overlap != stale data).
    events_at_by_city: dict[str, Any] = dict.fromkeys(cities)
    for city, latest_created_at in session.execute(
        select(Event.city, func.max(Event.created_at))
        .where(Event.city.in_(cities))
        .group_by(Event.city)
    ):
        events_at_by_city[city] = latest_created_at

    # Competitors of the in-scope properties, then the latest captured rate
    # per (competitor, stay date) via row_number over captured_at DESC.
    competitor_rows = session.execute(
        select(Competitor.id, Competitor.property_id).where(
            Competitor.property_id.in_(property_ids)
        )
    ).all()
    competitors_by_property: dict[UUID, list[UUID]] = {}
    for competitor_id, prop_id in competitor_rows:
        competitors_by_property.setdefault(prop_id, []).append(competitor_id)
    all_competitor_ids = [competitor_id for competitor_id, _ in competitor_rows]

    latest_rate_by_key: dict[tuple[UUID, date], Any] = {}
    if all_competitor_ids:
        row_number = (
            func.row_number()
            .over(
                partition_by=(ScrapedRate.competitor_id, ScrapedRate.stay_date),
                order_by=ScrapedRate.captured_at.desc(),
            )
            .label("row_number")
        )
        latest_rates = (
            select(ScrapedRate.competitor_id, ScrapedRate.stay_date, ScrapedRate.price, row_number)
            .where(
                ScrapedRate.competitor_id.in_(all_competitor_ids),
                ScrapedRate.stay_date >= today,
                ScrapedRate.stay_date < horizon_end,
            )
            .subquery()
        )
        for competitor_id, stay_date, price in session.execute(
            select(
                latest_rates.c.competitor_id, latest_rates.c.stay_date, latest_rates.c.price
            ).where(latest_rates.c.row_number == 1)
        ):
            latest_rate_by_key[(competitor_id, stay_date)] = price

    # Freshness of the market data: latest succeeded scrape run.
    scraped_rates_at = session.execute(
        select(func.max(ScrapeRun.finished_at)).where(ScrapeRun.status == "succeeded")
    ).scalar()

    inputs: list[RecommendationInput] = []
    for room_type, city in room_rows:
        competitor_ids = competitors_by_property.get(room_type.property_id, [])
        for stay_date in stay_dates:
            rates = [
                latest_rate_by_key[(competitor_id, stay_date)]
                for competitor_id in competitor_ids
                if (competitor_id, stay_date) in latest_rate_by_key
            ]
            ctx = RuleContext(
                city=city,
                stay_date=stay_date,
                base_price=room_type.base_price,
                currency=room_type.currency,
                current_price=room_type.current_price,
                lead_days=(stay_date - today).days,
                events=events_by_city[city],
                competitor_rates=rates,
                scraped_rates_at=scraped_rates_at,
                events_at=events_at_by_city[city],
            )
            inputs.append(
                RecommendationInput(
                    tenant_id=room_type.tenant_id,
                    property_id=room_type.property_id,
                    room_type_id=room_type.id,
                    ctx=ctx,
                )
            )
    return inputs


def _parse_uuid(value: Any) -> UUID | None:
    if value is None or value == "":
        return None
    return value if isinstance(value, UUID) else UUID(str(value))


def handle_generate_recommendations(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    """Recompute recommendations via the engine pipeline and persist them.

    Idempotency: PENDING rows for each in-scope (room_type_id, stay_date) are
    replaced (deleted, then re-inserted from the fresh computation). Rows the
    user already decided (accepted/dismissed — the backend flips status) are
    never touched; their (room_type_id, stay_date) keys are skipped entirely
    and counted in ``skipped``.
    """
    tenant_id = _parse_uuid(payload.get("tenant_id"))
    property_id = _parse_uuid(payload.get("property_id"))
    horizon_days = int(payload.get("horizon_days") or 90)
    today = date.today()
    logger.info("engine.generate_recommendations: payload=%s", payload)

    inputs = _load_rule_contexts(
        session,
        tenant_id=tenant_id,
        property_id=property_id,
        horizon_days=horizon_days,
        today=today,
    )
    if not inputs:
        return {"generated": 0, "skipped": 0}

    room_type_ids = {item.room_type_id for item in inputs}
    horizon_end = today + timedelta(days=horizon_days)
    in_scope = (
        Recommendation.room_type_id.in_(room_type_ids),
        Recommendation.stay_date >= today,
        Recommendation.stay_date < horizon_end,
    )

    decided_keys = set(
        session.execute(
            select(Recommendation.room_type_id, Recommendation.stay_date).where(
                *in_scope, Recommendation.status != "pending"
            )
        ).all()
    )
    session.execute(delete(Recommendation).where(*in_scope, Recommendation.status == "pending"))

    rows: list[dict[str, Any]] = []
    skipped = 0
    for item in inputs:
        if (item.room_type_id, item.ctx.stay_date) in decided_keys:
            skipped += 1
            continue
        result = compute(item.ctx)
        factors = build_factors_payload(item.ctx, result)
        rows.append(
            {
                "tenant_id": item.tenant_id,
                "property_id": item.property_id,
                "room_type_id": item.room_type_id,
                "stay_date": item.ctx.stay_date,
                "current_price": item.ctx.current_price,
                "recommended_price": result.recommended_price,
                "currency": item.ctx.currency,
                "expected_impact": factors["expected_impact"]["estimate"],
                # Boundary rule: floats exist only inside the serialized JSON
                # payload (see pricepilot.engine.serialization), never in the
                # Decimal price columns above.
                "factors": to_jsonable(factors),
                "status": "pending",
            }
        )
    if rows:
        session.execute(insert(Recommendation), rows)
    return {"generated": len(rows), "skipped": skipped}


Handler = Callable[[Session, dict[str, Any]], dict[str, Any]]

HANDLERS: dict[str, Handler] = {
    "scrape.competitor_rates": handle_scrape_competitor_rates,
    "ingest.events": handle_ingest_events,
    "ingest.demand_signals": handle_ingest_demand_signals,
    "engine.generate_recommendations": handle_generate_recommendations,
}
