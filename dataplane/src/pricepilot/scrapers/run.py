"""Manual scrape runner: live-test a source without the scheduler.

Dry run (default) fetches, parses and matches, then prints what WOULD be
persisted — nothing is written. ``--write`` runs the real orchestrator
(``scraped_rates`` + ``scrape_runs``). Requires the dev database for
competitor lookup either way::

    python -m pricepilot.scrapers.run --city sibiu --days 7
    python -m pricepilot.scrapers.run --property-id <uuid> --days 30 --write
"""

import argparse
import sys
from datetime import date, timedelta
from uuid import UUID

from pricepilot.config import get_settings
from pricepilot.db.session import get_session_factory
from pricepilot.scrapers import SCRAPERS
from pricepilot.scrapers.client import PoliteClient
from pricepilot.scrapers.orchestrator import (
    SupportsGet,
    collect_source_observations,
    competitors_by_city,
    scrape_city,
)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m pricepilot.scrapers.run",
        description="Scrape competitor rates once, outside the scheduler.",
    )
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--city", help="scrape all properties' competitors in this city")
    scope.add_argument("--property-id", type=UUID, help="scrape one property's competitors")
    parser.add_argument(
        "--sources",
        default=None,
        help="comma-separated sources; default: SCRAPE_SOURCES from the environment",
    )
    parser.add_argument(
        "--days", type=int, default=None, help="stay-date window; default: SCRAPE_DAYS_AHEAD"
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="persist scraped_rates + scrape_runs (default: dry run, print only)",
    )
    return parser


def main(
    argv: list[str] | None = None,
    *,
    client: SupportsGet | None = None,
    session_factory=None,
) -> int:
    args = _build_parser().parse_args(argv)
    settings = get_settings()
    days = args.days or settings.scrape_days_ahead
    sources = (
        [name.strip() for name in args.sources.split(",") if name.strip()]
        if args.sources
        else settings.scrape_source_list()
    )
    today = date.today()
    stay_dates = [today + timedelta(days=offset) for offset in range(days)]

    session = (session_factory or get_session_factory())()
    owns_client = client is None
    active_client: SupportsGet = client if client is not None else PoliteClient()
    try:
        scoped = competitors_by_city(
            session, property_id=args.property_id, city=args.city
        )
        if not scoped:
            print("no competitors configured for this scope", file=sys.stderr)
            return 1

        for city in sorted(scoped):
            competitors = scoped[city]
            if args.write:
                result = scrape_city(
                    session,
                    active_client,
                    city=city,
                    competitors=competitors,
                    stay_dates=stay_dates,
                    sources=sources,
                    currency=settings.scrape_currency,
                    max_pages=settings.scrape_max_pages,
                )
                print(f"{city}: {result}")
                continue

            for source_name in sources:
                scraper_cls = SCRAPERS.get(source_name)
                if scraper_cls is None:
                    print(f"{city} / {source_name}: unknown source", file=sys.stderr)
                    continue
                scraper = scraper_cls(currency=settings.scrape_currency)
                if not scraper.implemented:
                    print(f"{city} / {source_name}: not implemented, skipped")
                    continue
                outcome = collect_source_observations(
                    scraper,
                    active_client,
                    city=city,
                    competitors=competitors,
                    stay_dates=stay_dates,
                    expected_currency=settings.scrape_currency,
                    max_pages=settings.scrape_max_pages,
                )
                name_by_id = {c.id: c.name for c in competitors}
                print(
                    f"{city} / {source_name}: {len(outcome.observations)} observations "
                    f"over {outcome.dates_fetched} dates ({outcome.dates_failed} failed)"
                )
                for observation in outcome.observations:
                    print(
                        f"  {observation.stay_date}  "
                        f"{name_by_id[observation.competitor_id]:<35} "
                        f"{observation.price} {observation.currency}"
                    )
                if outcome.unmatched:
                    print(f"  unmatched: {', '.join(sorted(outcome.unmatched))}")
                for issue in outcome.issues:
                    print(f"  issue: {issue}")

        if not args.write:
            print("DRY RUN — nothing written. Use --write to persist.")
        return 0
    finally:
        session.close()
        if owns_client:
            active_client.close()  # type: ignore[attr-defined]


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
