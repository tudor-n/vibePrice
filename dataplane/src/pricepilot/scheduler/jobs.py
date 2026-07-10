"""Jobs-table claiming and handlers (contract: ``shared/contracts/jobs.md``).

Claiming is atomic so multiple workers never double-claim: Postgres does not
allow ``LIMIT`` directly in ``UPDATE``, so the claim uses a subquery with
``FOR UPDATE SKIP LOCKED`` and ``RETURNING``. Handlers must be idempotent —
re-running a succeeded job is always safe.
"""

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from pricepilot.config import get_settings
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
from pricepilot.ingest.holidays import holiday_signal_records
from pricepilot.ingest.signals import upsert_signals
from pricepilot.ingest.weather import CITY_COORDS, fetch_weather_signals
from pricepilot.places import PlaceCandidate, get_places_provider
from pricepilot.scrapers.booking import BookingScraper
from pricepilot.scrapers.client import PoliteClient, ScraperBlockedError, ScraperFetchError
from pricepilot.scrapers.linker import resolve_competitor_link
from pricepilot.scrapers.matching import CompetitorRef
from pricepilot.scrapers.orchestrator import SupportsGet, competitors_by_city, scrape_city

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


def handle_scrape_competitor_rates(
    session: Session,
    payload: dict[str, Any],
    *,
    client: SupportsGet | None = None,
) -> dict[str, Any]:
    """Scrape OTA rates for competitors of one property, a city, or everything.

    Scope resolution (contract ``jobs.md`` — nulls mean "all"): a
    ``property_id`` wins over ``city`` (its own city is used); a bare ``city``
    covers every property there; neither → all properties grouped by city.
    This is the system dispatch path, not a user-facing query; results land in
    ``scraped_rates``/``scrape_runs`` which are market data, not tenant data.

    Idempotency: observations are append-only history — a re-run appends a
    fresh capture set and the engine reads latest-per-(competitor, stay date).
    Raises (→ job ``failed``) only when every attempted source wrote nothing.
    ``client`` is injectable for tests; production builds a PoliteClient.
    """
    settings = get_settings()
    property_id = _parse_uuid(payload.get("property_id"))
    payload_city = (payload.get("city") or "").strip().lower() or None
    today = date.today()
    stay_dates = [today + timedelta(days=offset) for offset in range(settings.scrape_days_ahead)]
    sources = settings.scrape_source_list()
    currency = settings.scrape_currency
    logger.info("scrape.competitor_rates: payload=%s sources=%s", payload, sources)

    scoped_competitors = competitors_by_city(
        session, property_id=property_id, city=payload_city
    )
    if not scoped_competitors:
        return {"rates_written": 0, "note": "no competitors configured for this scope"}

    owns_client = client is None
    active_client: SupportsGet = client if client is not None else PoliteClient()
    try:
        cities: dict[str, Any] = {}
        total_written = 0
        for city in sorted(scoped_competitors):
            city_result = scrape_city(
                session,
                active_client,
                city=city,
                competitors=scoped_competitors[city],
                stay_dates=stay_dates,
                sources=sources,
                currency=currency,
            )
            cities[city] = city_result
            total_written += city_result["rates_written"]
    finally:
        if owns_client:
            active_client.close()  # type: ignore[attr-defined]

    attempted = [
        (city, source_name, report)
        for city, city_result in cities.items()
        for source_name, report in city_result["sources"].items()
        if "skipped" not in report
    ]
    if attempted and total_written == 0:
        summary = "; ".join(
            f"{city}/{source_name}: {report['error'] or 'no rates written'}"
            for city, source_name, report in attempted
        )
        raise RuntimeError(f"scrape wrote no rates — {summary}")
    return {"rates_written": total_written, "cities": cities}


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


#: Holiday signals look this far ahead (a full year of bookable dates).
HOLIDAY_WINDOW_DAYS = 365


def handle_ingest_demand_signals(
    session: Session,
    payload: dict[str, Any],
    *,
    weather_http_get: Any = None,
) -> dict[str, Any]:
    """Refresh public demand signals (RO holidays + Open-Meteo weather) for a city.

    All-or-nothing: any exception propagates, the poller rolls back and marks
    the job failed, and the nightly schedule retries. Weather is skipped with
    a note for cities without coordinates (holidays are pure computation and
    always available). Upserts are idempotent on (city, signal_type, date);
    ``created_at`` refreshes on re-ingest — it is the freshness marker.
    ``weather_http_get`` is injectable for tests (fixtures, never the network).
    """
    city = (payload.get("city") or "sibiu").strip().lower()
    today = date.today()

    holiday_records = holiday_signal_records(
        city, start=today, end=today + timedelta(days=HOLIDAY_WINDOW_DAYS)
    )
    holidays_written = upsert_signals(session, holiday_records, source="python-holidays")

    weather_report: int | str
    if city in CITY_COORDS:
        weather_records = fetch_weather_signals(city, http_get=weather_http_get)
        weather_written = upsert_signals(session, weather_records, source="open-meteo")
        weather_report = weather_written
    else:
        weather_written = 0
        weather_report = "skipped: no coordinates for city"

    logger.info(
        "ingest.demand_signals: city=%s holidays=%d weather=%s",
        city,
        holidays_written,
        weather_report,
    )
    return {
        "city": city,
        "signals_written": holidays_written + weather_written,
        "holidays_written": holidays_written,
        "weather": weather_report,
    }


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
    replaced (deleted, then re-inserted from the fresh computation), and stale
    PENDING rows whose stay date has already passed are purged in the same
    transaction so they never accumulate. Rows the user already decided
    (accepted/dismissed — the backend flips status) are never touched,
    whatever their date; in-horizon decided keys are skipped entirely and
    counted in ``skipped``.
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
    # Delete pending rows for the scoped room types (tenant isolation: the ids
    # come from the tenant/property-scoped load above). No lower date bound on
    # purpose — this both clears the horizon for re-insertion AND purges stale
    # pending rows whose stay date has passed. Decided rows are never deleted.
    session.execute(
        delete(Recommendation).where(
            Recommendation.room_type_id.in_(room_type_ids),
            Recommendation.stay_date < horizon_end,
            Recommendation.status == "pending",
        )
    )

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


#: How many search candidates to stash for the correction picker.
PLACE_CANDIDATE_LIMIT = 5


def handle_resolve_place(
    session: Session,
    payload: dict[str, Any],
    *,
    provider: Any = None,
) -> dict[str, Any]:
    """Resolve a property to a Google place; write geo/rating + candidates.

    Idempotent: re-running re-resolves and overwrites. On a match, the top
    result populates the place columns, the top ``PLACE_CANDIDATE_LIMIT`` are
    stashed for the correction picker, and ``discover_competitors`` is enqueued.
    On no match, the ``"__failed__"`` sentinel goes into ``place_candidates``
    and ``place_resolved_at`` stays null (backend derives place_status='failed').
    ``provider`` is injectable for tests; production uses ``get_places_provider()``.
    """
    property_id = _parse_uuid(payload.get("property_id"))
    if property_id is None:
        raise ValueError("resolve_place requires property_id")
    prop = session.get(Property, property_id)
    if prop is None:
        return {"resolved": False, "reason": "property not found"}

    query = (payload.get("query") or f"{prop.name}").strip()
    active = provider if provider is not None else get_places_provider()
    candidates: list[PlaceCandidate] = active.text_search(query, city=prop.city)

    if not candidates:
        session.execute(
            update(Property).where(Property.id == property_id).values(
                place_candidates="__failed__", place_resolved_at=None,
            )
        )
        session.commit()
        return {"resolved": False, "reason": f"no match for {query!r}"}

    top = candidates[0]
    stash = [c.to_dict() for c in candidates[:PLACE_CANDIDATE_LIMIT]]
    session.execute(
        update(Property).where(Property.id == property_id).values(
            place_id=top.place_id,
            latitude=top.latitude,
            longitude=top.longitude,
            rating=top.rating,
            rating_count=top.rating_count,
            place_resolved_at=func.now(),
            place_candidates=stash,
        )
    )
    enqueue_job(session, "discover_competitors", {"property_id": str(property_id)})
    session.commit()
    return {
        "property_id": str(property_id),
        "resolved": True,
        "place_id": top.place_id,
        "candidate_count": len(stash),
    }


#: Namespace for deterministic competitor ids derived from a Google place_id.
DISCOVERY_NS = uuid.UUID("6f9619ff-8b86-d011-b42d-00cf4fc964ff")


def handle_discover_competitors(
    session: Session,
    payload: dict[str, Any],
    *,
    provider: Any = None,
) -> dict[str, Any]:
    """Auto-discover nearby lodging competitors from a resolved property.

    Idempotent: each competitor's id is ``uuid5(DISCOVERY_NS, place_id)`` so a
    re-run updates in place. The property's own place is skipped; any place
    whose competitor row is tombstoned (``excluded_at`` set) is left removed —
    the owner's untrack is permanent. Capped at
    ``settings.competitor_discovery_max`` (overflow logged, never silently
    dropped). No-op with a reason if the property is unresolved.
    """
    settings = get_settings()
    property_id = _parse_uuid(payload.get("property_id"))
    prop = session.get(Property, property_id) if property_id else None
    if prop is None:
        return {"discovered": 0, "reason": "property not found"}
    if prop.latitude is None or prop.longitude is None:
        return {"discovered": 0, "reason": "property not resolved (no coordinates)"}

    active = provider if provider is not None else get_places_provider()
    found: list[PlaceCandidate] = active.nearby(
        prop.latitude, prop.longitude,
        radius_m=settings.competitor_discovery_radius_m, kind="lodging",
    )

    # Existing rows for this property, keyed by place_id, to honor tombstones.
    existing = {
        c.place_id: c
        for c in session.execute(
            select(Competitor).where(Competitor.property_id == prop.id)
        ).scalars()
        if c.place_id is not None
    }

    discovered = skipped_excluded = capped = 0
    for candidate in found:
        if candidate.place_id == prop.place_id:
            continue  # never track yourself
        row = existing.get(candidate.place_id)
        if row is not None and row.excluded_at is not None:
            skipped_excluded += 1
            continue  # tombstoned: owner's removal is permanent
        if row is None and discovered >= settings.competitor_discovery_max:
            capped += 1
            continue
        cid = uuid.uuid5(DISCOVERY_NS, candidate.place_id)
        session.execute(
            pg_insert(Competitor)
            .values(
                id=cid, tenant_id=prop.tenant_id, property_id=prop.id,
                name=candidate.name, source_url=None,
                place_id=candidate.place_id,
                latitude=candidate.latitude, longitude=candidate.longitude,
                rating=candidate.rating, rating_count=candidate.rating_count,
                discovered_at=func.now(), discovery_source="google_nearby",
                created_at=func.now(),
            )
            .on_conflict_do_update(
                index_elements=[Competitor.id],
                set_={
                    "name": candidate.name,
                    "latitude": candidate.latitude,
                    "longitude": candidate.longitude,
                    "rating": candidate.rating,
                    "rating_count": candidate.rating_count,
                    "discovered_at": func.now(),
                },
            )
        )
        if row is None:
            discovered += 1
    if capped:
        logger.info(
            "discover_competitors: capped %d beyond max=%d for property %s",
            capped, settings.competitor_discovery_max, prop.id,
        )
    session.commit()
    enqueue_job(session, "link_competitor_sources", {"property_id": str(prop.id)})
    return {
        "property_id": str(prop.id), "discovered": discovered,
        "skipped_excluded": skipped_excluded, "capped": capped,
    }


#: Link searches use a near-future date only to form a valid Booking URL; the
#: card link (not its price) is what we read, so the exact date is irrelevant.
LINK_SEARCH_LEAD_DAYS = 30


def _competitors_needing_links(session: Session, *, property_id: UUID | None):
    """Rows (id, name, tenant_id, city) for competitors with no link yet, honoring tombstones."""
    query = (
        select(Competitor.id, Competitor.name, Competitor.tenant_id, Property.city)
        .join(Property, Competitor.property_id == Property.id)
        .where(Competitor.source_url.is_(None), Competitor.excluded_at.is_(None))
    )
    if property_id is not None:
        query = query.where(Competitor.property_id == property_id)
    return list(session.execute(query))


def handle_link_competitor_sources(
    session: Session,
    payload: dict[str, Any],
    *,
    client: Any = None,
) -> dict[str, Any]:
    """Resolve each unlinked competitor to its Booking listing URL (idempotent).

    Scope: ``property_id`` (one property) or null (a sweep over all). Only rows
    with ``source_url IS NULL`` and no ``excluded_at`` are touched, so an
    existing/corrected link is never clobbered and re-runs are safe. A Booking
    block aborts the remaining competitors and is reported. ``client`` is
    injectable for tests; production builds a PoliteClient.
    """
    settings = get_settings()
    property_id = _parse_uuid(payload.get("property_id"))
    rows = _competitors_needing_links(session, property_id=property_id)
    if not rows:
        return {"linked": 0, "unlinked": 0, "note": "no competitors need linking"}

    scraper = BookingScraper(currency=settings.scrape_currency)
    link_date = date.today() + timedelta(days=LINK_SEARCH_LEAD_DAYS)
    owns_client = client is None
    active_client = client if client is not None else PoliteClient()
    linked = unlinked = 0
    blocked = False
    try:
        for competitor_id, name, _tenant_id, city in rows:
            plan = scraper.plan_request(f"{name}, {city}", link_date)
            try:
                html = active_client.get(plan.url)
            except ScraperBlockedError:
                blocked = True
                break
            except ScraperFetchError:
                unlinked += 1
                continue
            cards = scraper.parse_listings(html)[: settings.competitor_link_max_results]
            ref = CompetitorRef(id=competitor_id, name=name, source_url=None)
            url = resolve_competitor_link(cards, ref, city, identity_of=scraper.identity_of)
            if url is None:
                unlinked += 1
                continue
            session.execute(
                update(Competitor).where(Competitor.id == competitor_id).values(source_url=url)
            )
            linked += 1
        session.commit()
    finally:
        if owns_client:
            active_client.close()

    return {
        "property_id": str(property_id) if property_id is not None else None,
        "linked": linked,
        "unlinked": unlinked,
        "blocked": blocked,
    }


Handler = Callable[[Session, dict[str, Any]], dict[str, Any]]

HANDLERS: dict[str, Handler] = {
    "scrape.competitor_rates": handle_scrape_competitor_rates,
    "ingest.events": handle_ingest_events,
    "ingest.demand_signals": handle_ingest_demand_signals,
    "engine.generate_recommendations": handle_generate_recommendations,
    "resolve_place": handle_resolve_place,
    "discover_competitors": handle_discover_competitors,
    "link_competitor_sources": handle_link_competitor_sources,
}
