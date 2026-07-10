"""Booking.com search-results scraper (pure: URL planning + parsing).

Strategy (ADR 0004): one search-results request per stay date returns every
listed property in the city with its cheapest nightly rate; the orchestrator
matches cards to competitors by name. Selectors target the ``data-testid``
markup of current result cards; expect breakage whenever Booking.com changes
markup — re-capture the fixture and fix the selectors together::

    python -m pricepilot.scrapers.capture booking --city sibiu

Prices are parsed defensively (RO "1.234 lei" thousands, "412,50" decimals,
NBSP grouping, US "1,234.56") and a listing is skipped outright when its price
or currency cannot be read with confidence — never guess money.
"""

import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from urllib.parse import urlencode, urljoin, urlsplit

from bs4 import BeautifulSoup

from pricepilot.scrapers.base import ListingRate, PlannedRequest, SearchScraper

BOOKING_SEARCH_URL = "https://www.booking.com/searchresults.html"
BOOKING_BASE_URL = "https://www.booking.com"

#: Booking paginates search results in blocks of this size (the `offset` param).
_PAGE_SIZE = 25

# \s in a str pattern matches Unicode whitespace incl. NBSP (\xa0) and
# narrow NBSP (\u202f), which Booking uses to group digits.
_PRICE_RE = re.compile(r"[0-9][0-9.,\s]*")

#: The price element proper; taxes/strikethrough live in sibling testids.
_PRICE_SELECTORS = (
    '[data-testid="price-and-discounted-price"]',
    'span[data-testid="price"]',
)


def booking_slug(url: str | None) -> str | None:
    """Stable Booking hotel id from a listing URL, e.g. 'ro/continental-forum-sibiu'.

    Locale infixes ('.en-gb') and query strings are stripped so the same hotel
    always yields the same key. Returns None for non-hotel or empty URLs.
    """
    if not url:
        return None
    parts = urlsplit(url).path.strip("/").split("/")
    # Booking hotel URLs look like /hotel/<cc>/<slug>[.<locale>].html
    if len(parts) < 3 or parts[0] != "hotel":
        return None
    country, filename = parts[1], parts[2]
    slug = filename.split(".", 1)[0]
    if not country or not slug:
        return None
    return f"{country}/{slug}"


def build_search_url(
    city: str, stay_date: date, *, currency: str = "RON", offset: int = 0
) -> str:
    """Search-results URL for one night (checkin=stay date, checkout=+1)."""
    params = {
        "ss": city,
        "checkin": stay_date.isoformat(),
        "checkout": (stay_date + timedelta(days=1)).isoformat(),
        "group_adults": 2,
        "no_rooms": 1,
        "group_children": 0,
        "selected_currency": currency,
        "lang": "en-us",
    }
    if offset:
        params["offset"] = offset
    return f"{BOOKING_SEARCH_URL}?{urlencode(params)}"


def parse_price(text: str) -> Decimal | None:
    """Extract a Decimal price from a display string, or None when unsure.

    Separator rule: with both ``.`` and ``,`` present, the later one is the
    decimal separator; a lone separator followed by exactly three digits is a
    thousands separator, otherwise it is the decimal separator.
    """
    match = _PRICE_RE.search(text)
    if match is None:
        return None
    token = re.sub(r"\s+", "", match.group()).strip(".,")
    if "." in token and "," in token:
        if token.rfind(",") > token.rfind("."):
            token = token.replace(".", "").replace(",", ".")
        else:
            token = token.replace(",", "")
    elif "," in token:
        head, _, tail = token.rpartition(",")
        if len(tail) == 3 and head:
            token = (head + tail).replace(",", "")
        else:
            token = f"{head.replace(',', '')}.{tail}" if head else tail
    elif "." in token:
        head, _, tail = token.rpartition(".")
        if len(tail) == 3 and head:
            token = (head + tail).replace(".", "")
    try:
        return Decimal(token)
    except InvalidOperation:
        return None


def detect_currency(text: str) -> str | None:
    """Map the currency tokens Booking actually displays; None = skip listing."""
    lowered = text.casefold()
    if "us$" in lowered or "usd" in lowered:
        return "USD"
    if "lei" in lowered or "ron" in lowered:
        return "RON"
    if "€" in text or "eur" in lowered:
        return "EUR"
    if "$" in text:
        return "USD"
    return None


def parse_listings(html: str) -> list[ListingRate]:
    """Extract (name, price, currency) from every priced property card."""
    soup = BeautifulSoup(html, "html.parser")
    listings: list[ListingRate] = []
    for card in soup.select('[data-testid="property-card"]'):
        title_el = card.select_one('[data-testid="title"]')
        price_el = next(
            (found for sel in _PRICE_SELECTORS if (found := card.select_one(sel))),
            None,
        )
        if title_el is None or price_el is None:
            continue  # sold-out / unpriced card
        name = title_el.get_text(strip=True)
        price_text = price_el.get_text(" ", strip=True)
        price = parse_price(price_text)
        currency = detect_currency(price_text)
        if not name or price is None or currency is None:
            continue
        link_el = card.select_one('a[data-testid="title-link"]')
        href = link_el.get("href") if link_el is not None else None
        url = urljoin(BOOKING_BASE_URL, href) if href else None
        listings.append(ListingRate(name=name, price=price, currency=currency, url=url))
    return listings


class BookingScraper(SearchScraper):
    name = "booking"

    def plan_request(self, city: str, stay_date: date, *, page: int = 0) -> PlannedRequest:
        return PlannedRequest(
            url=build_search_url(
                city, stay_date, currency=self.currency, offset=page * _PAGE_SIZE
            ),
            stay_date=stay_date,
        )

    def parse_listings(self, html: str) -> list[ListingRate]:
        return parse_listings(html)

    def identity_of(self, url: str | None) -> str | None:
        return booking_slug(url)
