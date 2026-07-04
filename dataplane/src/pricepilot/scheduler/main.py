"""Dataplane entrypoint: ``python -m pricepilot.scheduler.main``.

* Waits for the database with retry + log so ``docker compose up`` ordering
  never crashes it.
* If ``SCHEDULER_ENABLED``: APScheduler enqueues the recurring jobs (ingest
  02:00, scrape 04:00, engine 05:00 UTC) into the jobs table — observability
  via the same dispatch path the backend uses — rather than running work
  directly.
* Polls the jobs table every 5 seconds, claiming and executing one job at a
  time. Ctrl+C / SIGINT shuts down gracefully.
"""

import logging
import time

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from pricepilot.config import get_settings
from pricepilot.db.session import get_engine, get_session_factory
from pricepilot.scheduler.jobs import HANDLERS, claim_next_job, enqueue_job, finish_job

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 5.0
DB_RETRY_SECONDS = 5.0

DEFAULT_CITY = "sibiu"


def wait_for_db() -> None:
    """Block until the database answers, retrying forever with a log line."""
    while True:
        try:
            with get_engine().connect() as conn:
                conn.execute(text("SELECT 1"))
            logger.info("Database is reachable.")
            return
        except OperationalError as exc:
            logger.warning(
                "Database not reachable yet (%s); retrying in %ss", exc, DB_RETRY_SECONDS
            )
            time.sleep(DB_RETRY_SECONDS)


def _enqueue(job_type: str, payload: dict[str, object]) -> None:
    session = get_session_factory()()
    try:
        enqueue_job(session, job_type, payload)
        logger.info("Enqueued %s %s", job_type, payload)
    except SQLAlchemyError:
        logger.exception("Failed to enqueue %s", job_type)
        session.rollback()
    finally:
        session.close()


def enqueue_nightly_ingest() -> None:
    _enqueue("ingest.events", {"city": DEFAULT_CITY})
    _enqueue("ingest.demand_signals", {"city": DEFAULT_CITY})


def enqueue_nightly_scrape() -> None:
    _enqueue("scrape.competitor_rates", {"city": DEFAULT_CITY, "property_id": None})


def enqueue_nightly_engine() -> None:
    _enqueue(
        "engine.generate_recommendations",
        {"tenant_id": None, "property_id": None, "horizon_days": 90},
    )


def build_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(enqueue_nightly_ingest, CronTrigger(hour=2, minute=0), name="ingest")
    scheduler.add_job(enqueue_nightly_scrape, CronTrigger(hour=4, minute=0), name="scrape")
    scheduler.add_job(enqueue_nightly_engine, CronTrigger(hour=5, minute=0), name="engine")
    return scheduler


def poll_once() -> bool:
    """Claim and execute at most one job. Returns True when a job was handled."""
    session = get_session_factory()()
    try:
        job = claim_next_job(session)
        if job is None:
            return False
        handler = HANDLERS.get(job.type)
        if handler is None:
            logger.error("Unknown job type %r (job %s)", job.type, job.id)
            finish_job(session, job.id, status="failed", error=f"unknown job type: {job.type}")
            return True
        logger.info("Running job %s (%s)", job.id, job.type)
        try:
            result = handler(session, job.payload)
        except Exception as exc:  # a failing handler must never kill the worker
            logger.exception("Job %s (%s) failed", job.id, job.type)
            session.rollback()
            finish_job(session, job.id, status="failed", error=str(exc))
            return True
        finish_job(session, job.id, status="succeeded", result=result)
        logger.info("Job %s (%s) succeeded", job.id, job.type)
        return True
    except OperationalError as exc:
        logger.warning("Database unavailable during poll (%s); will retry", exc)
        session.rollback()
        return False
    finally:
        session.close()


def run() -> None:
    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logger.info("PricePilot dataplane starting (scheduler_enabled=%s)", settings.scheduler_enabled)

    wait_for_db()

    scheduler: BackgroundScheduler | None = None
    if settings.scheduler_enabled:
        scheduler = build_scheduler()
        scheduler.start()
        logger.info("APScheduler started: ingest 02:00, scrape 04:00, engine 05:00 (UTC)")

    try:
        while True:
            handled = poll_once()
            if not handled:
                time.sleep(POLL_INTERVAL_SECONDS)
    except KeyboardInterrupt:
        logger.info("Shutting down (KeyboardInterrupt)")
    finally:
        if scheduler is not None:
            scheduler.shutdown(wait=False)


if __name__ == "__main__":
    run()
