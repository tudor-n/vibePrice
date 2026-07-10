"""Pure competitor→Booking link resolution (no I/O)."""

import uuid
from decimal import Decimal

from pricepilot.scrapers.base import ListingRate
from pricepilot.scrapers.booking import booking_slug
from pricepilot.scrapers.linker import resolve_competitor_link
from pricepilot.scrapers.matching import CompetitorRef


def _card(name, slug):
    return ListingRate(
        name=name,
        price=Decimal("400"),
        currency="RON",
        url=f"https://www.booking.com/hotel/ro/{slug}.html",
    )


def test_resolve_returns_matched_card_url():
    cards = [_card("Hotel Ramada Sibiu", "ramada-sibiu"), _card("Casa Luxemburg", "casa-lux")]
    competitor = CompetitorRef(id=uuid.uuid4(), name="Ramada by Wyndham Sibiu")
    url = resolve_competitor_link(cards, competitor, "sibiu", identity_of=booking_slug)
    assert url == "https://www.booking.com/hotel/ro/ramada-sibiu.html"


def test_resolve_returns_none_when_no_confident_match():
    cards = [_card("Completely Unrelated Inn", "unrelated-inn")]
    competitor = CompetitorRef(id=uuid.uuid4(), name="Ramada by Wyndham Sibiu")
    assert resolve_competitor_link(cards, competitor, "sibiu", identity_of=booking_slug) is None
