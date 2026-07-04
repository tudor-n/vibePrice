"""Scraper parsing tests — saved HTML fixtures only, never live sites."""

from datetime import date
from decimal import Decimal
from pathlib import Path

from pricepilot.scrapers import SCRAPERS
from pricepilot.scrapers.booking import BookingScraper, parse_rates


def test_booking_parse_rates_from_fixture(fixtures_dir: Path) -> None:
    html = (fixtures_dir / "booking_sample.html").read_text(encoding="utf-8")
    rates = parse_rates(html)

    assert [(r.stay_date, r.price, r.currency) for r in rates] == [
        (date(2026, 6, 12), Decimal("412.00"), "RON"),
        (date(2026, 6, 13), Decimal("435.50"), "RON"),
        (date(2026, 6, 14), Decimal("398.00"), "RON"),
    ]
    for rate in rates:
        assert isinstance(rate.price, Decimal)  # money is never float


def test_booking_sold_out_days_are_skipped(fixtures_dir: Path) -> None:
    html = (fixtures_dir / "booking_sample.html").read_text(encoding="utf-8")
    stay_dates = {r.stay_date for r in parse_rates(html)}
    assert date(2026, 6, 15) not in stay_dates  # sold-out card has no price


def test_registry_contains_isolated_sources() -> None:
    assert SCRAPERS["booking"] is BookingScraper
    assert set(SCRAPERS) == {"booking", "airbnb"}
