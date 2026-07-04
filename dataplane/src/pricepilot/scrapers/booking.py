"""Booking.com scraper.

Parsing is real (against the markup captured in
``tests/fixtures/booking_sample.html``); live fetching is not implemented yet.
Expect breakage whenever Booking.com changes markup — the fixture must then be
re-captured and the selectors updated together.
"""

from datetime import date
from decimal import Decimal

from bs4 import BeautifulSoup, Tag

from pricepilot.scrapers.base import BaseScraper, ParsedRate, RateObservation


def parse_rates(html: str) -> list[ParsedRate]:
    """Extract (stay_date, price, currency) triples from a Booking.com rates page.

    Pure function — safe to test against saved HTML fixtures.
    """
    soup = BeautifulSoup(html, "html.parser")
    rates: list[ParsedRate] = []
    for card in soup.select("div.rate-card[data-stay-date]"):
        price_el = card.select_one("span.rate-price")
        if not isinstance(price_el, Tag):
            continue
        stay_date = date.fromisoformat(str(card["data-stay-date"]))
        price = Decimal(price_el.get_text(strip=True))
        currency = str(price_el.get("data-currency", "RON"))
        rates.append(ParsedRate(stay_date=stay_date, price=price, currency=currency))
    return rates


class BookingScraper(BaseScraper):
    name = "booking"

    def parse(self, html: str) -> list[ParsedRate]:
        return parse_rates(html)

    def fetch(self, source_url: str, stay_dates: list[date]) -> list[RateObservation]:
        raise NotImplementedError(
            "BookingScraper.fetch is not implemented yet: it will use httpx with "
            "Settings.scraper_user_agent / scraper_proxy_url to request availability "
            "pages per stay date, then run parse(). Tests must never trigger live "
            "fetches — use tests/fixtures/ HTML instead."
        )
