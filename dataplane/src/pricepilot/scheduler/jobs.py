"""Jobs-table claiming and handlers (contract: ``shared/contracts/jobs.md``).

Claiming is atomic so multiple workers never double-claim: Postgres does not
allow ``LIMIT`` directly in ``UPDATE``, so the claim uses a subquery with
``FOR UPDATE SKIP LOCKED`` and ``RETURNING``. Handlers must be idempotent —
re-running a succeeded job is always safe.
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import func, insert, text, update
from sqlalchemy.orm import Session

from pricepilot.db.tables import Job
from pricepilot.engine.explainer import build_factors_payload
from pricepilot.engine.models import RuleContext
from pricepilot.engine.pipeline import compute

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
    """Refresh the events calendar for a city."""
    logger.info("ingest.events stub: payload=%s", payload)
    # TODO: run StaticSibiuEventSource (later: real calendar scraping) and
    # upsert into the events table keyed on (city, name, start_date).
    return {"note": "stub — no events ingested", "events_written": 0}


def handle_ingest_demand_signals(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    """Refresh public stats/holidays/weather signals for a city."""
    logger.info("ingest.demand_signals stub: payload=%s", payload)
    # TODO: run ingest.holidays / ingest.tourism_stats / ingest.weather and
    # upsert into demand_signals.
    return {"note": "stub — no signals ingested", "signals_written": 0}


def _load_rule_contexts(session: Session, payload: dict[str, Any]) -> list[RuleContext]:
    """Load one RuleContext per (room type, stay date) in scope.

    TODO(data-loading): query room_types (scoped by tenant_id/property_id from
    the payload — tenant isolation!), competitor scraped_rates per stay date,
    events for each property's city, and freshness timestamps, for every stay
    date in the horizon. Returns [] until then.
    """
    return []


def handle_generate_recommendations(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    """Recompute recommendations via the engine pipeline."""
    horizon_days = payload.get("horizon_days", 90)
    logger.info("engine.generate_recommendations: payload=%s", payload)

    written = 0
    for ctx in _load_rule_contexts(session, payload):
        result = compute(ctx)
        factors = build_factors_payload(ctx, result)
        # TODO(persistence): insert a pricepilot.db.tables.Recommendation row
        # (tenant_id, property_id, room_type_id, stay_date, prices, factors)
        # with a Decimal-aware JSON serializer for the factors payload.
        # Idempotency: replace any pending recommendation for the same
        # (room_type_id, stay_date) instead of duplicating it.
        del factors
        written += 1
    return {"recommendations_written": written, "horizon_days": horizon_days}


Handler = Callable[[Session, dict[str, Any]], dict[str, Any]]

HANDLERS: dict[str, Handler] = {
    "scrape.competitor_rates": handle_scrape_competitor_rates,
    "ingest.events": handle_ingest_events,
    "ingest.demand_signals": handle_ingest_demand_signals,
    "engine.generate_recommendations": handle_generate_recommendations,
}
