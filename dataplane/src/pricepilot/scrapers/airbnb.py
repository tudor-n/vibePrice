"""Airbnb scraper stub.

Airbnb renders listings client-side, so this scraper will likely need a JSON
API endpoint or a rendered-HTML capture rather than plain page HTML. Not
implemented in v1 scaffolding.
"""

from datetime import date

from pricepilot.scrapers.base import BaseScraper, ParsedRate, RateObservation


class AirbnbScraper(BaseScraper):
    name = "airbnb"

    def parse(self, html: str) -> list[ParsedRate]:
        raise NotImplementedError(
            "AirbnbScraper.parse is not implemented yet. Capture a fixture into "
            "tests/fixtures/ first, then implement parsing against it "
            "(see scrapers/booking.py for the pattern)."
        )

    def fetch(self, source_url: str, stay_dates: list[date]) -> list[RateObservation]:
        raise NotImplementedError(
            "AirbnbScraper.fetch is not implemented yet. Tests must never trigger "
            "live fetches — use tests/fixtures/ HTML instead."
        )
