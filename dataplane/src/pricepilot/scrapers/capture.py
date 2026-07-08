"""Capture one live search page into a fixture file.

The human-in-the-loop half of the scraper maintenance loop (ADR 0004): when a
source changes markup or starts blocking, a person runs this against the live
site (same PoliteClient the scheduler uses — politeness, UA and proxy all
apply), inspects the saved HTML, trims it into ``tests/fixtures/``, and fixes
the parser until the fixture tests are green again.

    python -m pricepilot.scrapers.capture booking --city sibiu \
        --out tests/fixtures/booking_search_sibiu_live.html

The command re-parses what it saved and prints the listing count — zero
parsed listings on a successfully fetched page means the selectors are stale.
"""

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

from pricepilot.config import get_settings
from pricepilot.scrapers import SCRAPERS
from pricepilot.scrapers.client import (
    PoliteClient,
    ScraperBlockedError,
    ScraperFetchError,
)
from pricepilot.scrapers.orchestrator import SupportsGet


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m pricepilot.scrapers.capture",
        description="Fetch one live search page and save it as a parser fixture.",
    )
    parser.add_argument("source", choices=sorted(SCRAPERS), help="scraper source name")
    parser.add_argument("--city", required=True, help="city slug, e.g. sibiu")
    parser.add_argument(
        "--checkin",
        type=date.fromisoformat,
        default=None,
        help="stay date (ISO); default: 30 days from today",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="output path; default: tests/fixtures/{source}_search_{city}_live.html",
    )
    return parser


def main(argv: list[str] | None = None, *, client: SupportsGet | None = None) -> int:
    args = _build_parser().parse_args(argv)
    settings = get_settings()
    checkin = args.checkin or (date.today() + timedelta(days=30))
    out_path = Path(args.out or f"tests/fixtures/{args.source}_search_{args.city}_live.html")

    scraper = SCRAPERS[args.source](currency=settings.scrape_currency)
    if not scraper.implemented:
        print(f"error: source {args.source!r} is not implemented yet", file=sys.stderr)
        return 2

    plan = scraper.plan_request(args.city, checkin)
    print(f"Fetching {plan.url}")
    owns_client = client is None
    active_client: SupportsGet = client if client is not None else PoliteClient()
    try:
        html = active_client.get(plan.url)
    except ScraperBlockedError as exc:
        print(f"error: blocked by the source — {exc}", file=sys.stderr)
        return 3
    except ScraperFetchError as exc:
        print(f"error: fetch failed — {exc}", file=sys.stderr)
        return 3
    finally:
        if owns_client:
            active_client.close()  # type: ignore[attr-defined]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")

    listings = scraper.parse_listings(html)
    print(f"Saved {len(html)} chars to {out_path}; parsed {len(listings)} listings.")
    if listings:
        for listing in listings[:5]:
            print(f"  {listing.name}: {listing.price} {listing.currency}")
    else:
        print(
            "0 listings parsed — the selectors are stale; inspect the capture "
            "and update the parser + fixture together."
        )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
