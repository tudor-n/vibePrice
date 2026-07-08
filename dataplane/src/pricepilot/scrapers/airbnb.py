"""Airbnb scraper — registered but not implemented.

Airbnb search results are client-rendered (JS), so this source needs a
browser-based fetcher or an API rather than plain page HTML. It stays in the
registry with ``implemented = False`` so scrape-job results report the gap
explicitly instead of silently ignoring Airbnb competitors (see roadmap).
"""

from datetime import date
from typing import ClassVar

from pricepilot.scrapers.base import ListingRate, PlannedRequest, SearchScraper

_NOT_IMPLEMENTED = (
    "Airbnb search results are client-rendered; a browser-based fetcher or "
    "API integration is needed — see docs/roadmap.md."
)


class AirbnbScraper(SearchScraper):
    name = "airbnb"
    implemented: ClassVar[bool] = False

    def plan_request(self, city: str, stay_date: date) -> PlannedRequest:
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def parse_listings(self, html: str) -> list[ListingRate]:
        raise NotImplementedError(_NOT_IMPLEMENTED)
