"""Scrape orchestration: compose client + scraper + matcher, persist results.

Collection (:func:`collect_source_observations`) is side-effect-free apart
from the injected client, so unit tests drive it with fakes and fixtures.
Persistence (:func:`scrape_city`) owns the ``scrape_runs`` bookkeeping and the
append-only ``scraped_rates`` inserts (history is intentional: the engine
reads latest-per-(competitor, stay date); rate evolution is future training
data).

Run-status semantics (spec 2026-07-08): a run that wrote at least one
observation finishes ``succeeded`` — per-date issues travel in ``error`` text
even on success; a run that wrote nothing finishes ``failed``. No competitors
in scope → no run row at all (an empty run must not fake market freshness).
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any, Protocol
from uuid import UUID

from sqlalchemy import func, insert, select, update
from sqlalchemy.orm import Session

from pricepilot.db.tables import Competitor, Property, ScrapedRate, ScrapeRun
from pricepilot.scrapers import SCRAPERS
from pricepilot.scrapers.base import RateObservation, SearchScraper
from pricepilot.scrapers.client import ScraperBlockedError, ScraperFetchError
from pricepilot.scrapers.matching import CompetitorRef, match_listings

logger = logging.getLogger(__name__)


def competitors_by_city(
    session: Session,
    *,
    property_id: UUID | None = None,
    city: str | None = None,
) -> dict[str, list[CompetitorRef]]:
    """Resolve the scrape scope to competitors grouped by their property's city.

    ``property_id`` wins over ``city``; both ``None`` means every property
    (the system-wide nightly job — jobs.md: nulls mean "all").
    """
    query = select(
        Competitor.id, Competitor.name, Competitor.source_url, Property.city
    ).join(Property, Competitor.property_id == Property.id)
    if property_id is not None:
        query = query.where(Competitor.property_id == property_id)
    elif city is not None:
        query = query.where(func.lower(Property.city) == city.strip().lower())

    grouped: dict[str, list[CompetitorRef]] = {}
    for competitor_id, name, source_url, property_city in session.execute(query):
        grouped.setdefault(property_city, []).append(
            CompetitorRef(id=competitor_id, name=name, source_url=source_url)
        )
    return grouped


class SupportsGet(Protocol):
    """The one client capability scrapers consume (PoliteClient or a fake)."""

    def get(self, url: str) -> str: ...


@dataclass
class SourceOutcome:
    """Everything one source's pass over the stay-date window produced."""

    observations: list[RateObservation] = field(default_factory=list)
    dates_fetched: int = 0
    dates_failed: int = 0
    issues: list[str] = field(default_factory=list)
    blocked: bool = False
    unmatched: list[str] = field(default_factory=list)


def collect_source_observations(
    scraper: SearchScraper,
    client: SupportsGet,
    *,
    city: str,
    competitors: Sequence[CompetitorRef],
    stay_dates: Sequence[date],
    expected_currency: str,
    max_pages: int = 1,
) -> SourceOutcome:
    """Fetch/parse/match the whole window for one source. No DB access.

    Per stay date, fetch result pages only until every in-scope competitor is
    matched or ``max_pages`` is reached (adaptive: usually one request). A block
    aborts the remaining dates; a transient failure skips only its date. Matched
    observations in a different currency than requested are dropped with a note.
    """
    outcome = SourceOutcome()
    matched_ever: set[Any] = set()
    currency_mismatch_dates: dict[tuple[str, str], int] = {}

    for index, stay_date in enumerate(stay_dates):
        listings: list[Any] = []
        matches: dict[Any, Any] = {}
        fetched = False
        block_issue: str | None = None

        for page in range(max_pages):
            plan = scraper.plan_request(city, stay_date, page=page)
            try:
                html = client.get(plan.url)
            except ScraperBlockedError as exc:
                remaining = len(stay_dates) - index
                block_issue = (
                    f"{stay_date}: blocked ({exc}); aborted the remaining {remaining - 1} dates"
                )
                break
            except ScraperFetchError as exc:
                if page == 0:
                    outcome.dates_failed += 1
                    outcome.issues.append(f"{stay_date}: {exc}")
                else:
                    outcome.issues.append(f"{stay_date} page {page + 1}: {exc}")
                break

            fetched = True
            listings.extend(scraper.parse_listings(html))
            matches = match_listings(listings, competitors, city, identity_of=scraper.identity_of)
            if len(matches) >= len(competitors):
                break  # everyone found; stop paging

        if block_issue is not None:
            outcome.blocked = True
            outcome.dates_failed += len(stay_dates) - index
            outcome.issues.append(block_issue)
            break

        if not fetched:
            continue

        outcome.dates_fetched += 1
        for competitor_id, listing in matches.items():
            matched_ever.add(competitor_id)
            if listing.currency != expected_currency:
                key = (listing.name, listing.currency)
                currency_mismatch_dates[key] = currency_mismatch_dates.get(key, 0) + 1
                continue
            outcome.observations.append(
                RateObservation(
                    competitor_id=competitor_id,
                    stay_date=stay_date,
                    price=listing.price,
                    currency=listing.currency,
                )
            )

    # One aggregated line per offender, not one per date (90-day windows would
    # otherwise flood scrape_runs.error with near-identical lines).
    for (name, currency), count in sorted(currency_mismatch_dates.items()):
        outcome.issues.append(
            f"currency mismatch {currency} for {name!r} on {count} "
            f"date{'s' if count != 1 else ''}; observations dropped"
        )

    if outcome.dates_fetched:
        outcome.unmatched = [
            competitor.name
            for competitor in competitors
            if competitor.id not in matched_ever
        ]
    return outcome


def scrape_city(
    session: Session,
    client: SupportsGet,
    *,
    city: str,
    competitors: Sequence[CompetitorRef],
    stay_dates: Sequence[date],
    sources: Sequence[str],
    currency: str,
    max_pages: int = 1,
) -> dict[str, Any]:
    """Run every enabled source for one city; persist rates + run bookkeeping."""
    source_reports: dict[str, Any] = {}
    total_written = 0

    for source_name in sources:
        scraper_cls = SCRAPERS.get(source_name)
        if scraper_cls is None:
            source_reports[source_name] = {"skipped": "unknown source"}
            logger.warning("scrape: unknown source %r requested", source_name)
            continue
        scraper = scraper_cls(currency=currency)
        if not scraper.implemented:
            source_reports[source_name] = {"skipped": "not implemented"}
            continue

        run = ScrapeRun(source=source_name, status="running")
        session.add(run)
        session.commit()  # the running row is observable while we work

        outcome = collect_source_observations(
            scraper,
            client,
            city=city,
            competitors=competitors,
            stay_dates=stay_dates,
            expected_currency=currency,
            max_pages=max_pages,
        )

        if outcome.observations:
            session.execute(
                insert(ScrapedRate),
                [
                    {
                        "competitor_id": observation.competitor_id,
                        "stay_date": observation.stay_date,
                        "price": observation.price,
                        "currency": observation.currency,
                    }
                    for observation in outcome.observations
                ],
            )

        issues = list(outcome.issues)
        if outcome.unmatched:
            issues.append("unmatched competitors: " + ", ".join(sorted(outcome.unmatched)))
        error_text = "; ".join(issues) or None
        status = "succeeded" if outcome.observations else "failed"
        session.execute(
            update(ScrapeRun)
            .where(ScrapeRun.id == run.id)
            .values(status=status, finished_at=datetime.now(UTC), error=error_text)
        )
        session.commit()

        written = len(outcome.observations)
        total_written += written
        source_reports[source_name] = {
            "rates_written": written,
            "dates_fetched": outcome.dates_fetched,
            "dates_failed": outcome.dates_failed,
            "unmatched": sorted(outcome.unmatched),
            "error": error_text,
        }
        logger.info(
            "scrape %s/%s: %d rates over %d dates (%d failed dates)",
            city,
            source_name,
            written,
            outcome.dates_fetched,
            outcome.dates_failed,
        )

    return {"rates_written": total_written, "sources": source_reports}
