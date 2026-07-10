"""Scraper parsing tests — saved HTML fixtures only, never live sites."""

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from pricepilot.scheduler.main import build_scheduler
from pricepilot.scrapers import SCRAPERS
from pricepilot.scrapers.airbnb import AirbnbScraper
from pricepilot.scrapers.base import ListingRate
from pricepilot.scrapers.booking import (
    BookingScraper,
    booking_slug,
    build_search_url,
    detect_currency,
    parse_listings,
    parse_price,
)


def test_build_search_url_exact() -> None:
    url = build_search_url("sibiu", date(2026, 8, 7))
    assert url == (
        "https://www.booking.com/searchresults.html"
        "?ss=sibiu&checkin=2026-08-07&checkout=2026-08-08"
        "&group_adults=2&no_rooms=1&group_children=0"
        "&selected_currency=RON&lang=en-us"
    )


def test_build_search_url_honors_currency() -> None:
    url = build_search_url("sibiu", date(2026, 8, 7), currency="EUR")
    assert "selected_currency=EUR" in url


def test_build_search_url_omits_offset_on_first_page() -> None:
    url = build_search_url("sibiu", date(2026, 7, 10))
    assert "offset" not in url


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("RON 412", Decimal("412")),
        ("412 lei", Decimal("412")),
        ("1.234 lei", Decimal("1234")),  # RO thousands separator
        ("RON 412,50", Decimal("412.50")),  # RO decimal comma
        ("€ 1,234.56", Decimal("1234.56")),  # US-style both separators
        ("RON 1 234", Decimal("1234")),  # NBSP-grouped
        ("1 234 lei", Decimal("1234")),  # narrow NBSP
        ("1.234.567 lei", Decimal("1234567")),
        ("Sold out", None),
        ("", None),
    ],
)
def test_parse_price(text: str, expected: Decimal | None) -> None:
    result = parse_price(text)
    assert result == expected
    if result is not None:
        assert isinstance(result, Decimal)  # money is never float


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("RON 412", "RON"),
        ("412 lei", "RON"),
        ("€ 95", "EUR"),
        ("EUR 95", "EUR"),
        ("US$120", "USD"),
        ("$120", "USD"),
        ("412", None),
    ],
)
def test_detect_currency(text: str, expected: str | None) -> None:
    assert detect_currency(text) == expected


def test_parse_listings_from_search_fixture(fixtures_dir: Path) -> None:
    html = (fixtures_dir / "booking_search_sibiu.html").read_text(encoding="utf-8")
    listings = parse_listings(html)

    assert listings == [
        ListingRate(
            name="Ramada by Wyndham Sibiu",
            price=Decimal("412"),
            currency="RON",
            url="https://www.booking.com/hotel/ro/ramada-sibiu.html",
        ),
        ListingRate(
            name="Hotel Împăratul Romanilor",
            price=Decimal("389"),
            currency="RON",
            url="https://www.booking.com/hotel/ro/imparatul-romanilor.en-gb.html",
        ),
        ListingRate(
            name="Casa Luxemburg",
            price=Decimal("1234"),
            currency="RON",
            url="https://www.booking.com/hotel/ro/casa-luxemburg-sibiu.html",
        ),
        ListingRate(
            name="Pensiunea Cetate Veche",
            price=Decimal("435.50"),
            currency="RON",
            url="https://www.booking.com/hotel/ro/pensiunea-cetate-veche.html",
        ),
        ListingRate(
            name="Golden Tulip Ana Tower",
            price=Decimal("95"),
            currency="EUR",
            url="https://www.booking.com/hotel/ro/golden-tulip-ana-tower-sibiu.html",
        ),
    ]
    for listing in listings:
        assert isinstance(listing.price, Decimal)


def test_sold_out_and_unpriced_cards_are_skipped(fixtures_dir: Path) -> None:
    html = (fixtures_dir / "booking_search_sibiu.html").read_text(encoding="utf-8")
    names = {listing.name for listing in parse_listings(html)}
    assert "Hotel Sold Out Palace" not in names  # card without a price element


def test_taxes_line_is_not_mistaken_for_the_price(fixtures_dir: Path) -> None:
    html = (fixtures_dir / "booking_search_sibiu.html").read_text(encoding="utf-8")
    ramada = next(
        listing
        for listing in parse_listings(html)
        if listing.name == "Ramada by Wyndham Sibiu"
    )
    assert ramada.price == Decimal("412")  # not the "+RON 62 taxes" line


def test_booking_slug_extracts_country_and_slug() -> None:
    assert booking_slug("https://www.booking.com/hotel/ro/ramada-sibiu.html") == "ro/ramada-sibiu"


def test_booking_slug_ignores_locale_and_query() -> None:
    url = "https://www.booking.com/hotel/ro/imparatul-romanilor.en-gb.html?checkin=2026-07-10"
    assert booking_slug(url) == "ro/imparatul-romanilor"


def test_booking_slug_none_for_non_hotel_or_empty() -> None:
    assert booking_slug("https://www.booking.com/searchresults.html") is None
    assert booking_slug(None) is None
    assert booking_slug("") is None


def test_parse_listings_extracts_hotel_url(fixtures_dir: Path) -> None:
    html = (fixtures_dir / "booking_search_sibiu.html").read_text(encoding="utf-8")
    by_name = {listing.name: listing for listing in parse_listings(html)}
    ramada = by_name["Ramada by Wyndham Sibiu"]
    assert ramada.url == "https://www.booking.com/hotel/ro/ramada-sibiu.html"
    assert booking_slug(ramada.url) == "ro/ramada-sibiu"


def test_plan_request_builds_search_url_with_instance_currency() -> None:
    plan = BookingScraper(currency="EUR").plan_request("sibiu", date(2026, 8, 7))
    assert plan.stay_date == date(2026, 8, 7)
    assert "selected_currency=EUR" in plan.url
    assert "checkin=2026-08-07" in plan.url


def test_plan_request_page_maps_to_offset() -> None:
    scraper = BookingScraper(currency="RON")
    url = scraper.plan_request("sibiu", date(2026, 7, 10), page=2).url
    assert "offset=50" in url  # page 2 * 25 per page


def test_registry_contains_isolated_sources() -> None:
    assert SCRAPERS["booking"] is BookingScraper
    assert set(SCRAPERS) == {"booking", "airbnb"}
    assert BookingScraper.implemented is True
    assert AirbnbScraper.implemented is False


def test_airbnb_is_explicitly_unimplemented() -> None:
    scraper = AirbnbScraper()
    with pytest.raises(NotImplementedError):
        scraper.plan_request("sibiu", date(2026, 8, 7))
    with pytest.raises(NotImplementedError):
        scraper.parse_listings("<html></html>")


def test_scheduler_registers_link_sweep() -> None:
    names = {job.name for job in build_scheduler().get_jobs()}
    assert "link" in names
