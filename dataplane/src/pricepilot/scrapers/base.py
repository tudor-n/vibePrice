"""Scraper base types (ADR 0004: city-search scraping with pure scrapers).

Scrapers are **fully pure**: they plan search-request URLs and parse HTML.
All network I/O lives in :class:`pricepilot.scrapers.client.PoliteClient`;
competitor matching and persistence live in
:mod:`pricepilot.scrapers.orchestrator`. Tests exercise scrapers against saved
HTML fixtures in ``tests/fixtures/`` only — never live sites (repo hard rule).

Keep each source isolated in its own module: scrapers are fragile and
ToS-gray by nature, and each must be swappable for a paid rate API without
touching the rest.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import ClassVar
from uuid import UUID


@dataclass(frozen=True)
class PlannedRequest:
    """One search-results request the orchestrator should perform."""

    url: str
    stay_date: date


@dataclass(frozen=True)
class ListingRate:
    """One property card parsed from a search page, not yet tied to a competitor."""

    name: str
    price: Decimal
    currency: str
    url: str | None = None


@dataclass(frozen=True)
class RateObservation:
    """A competitor rate observation, ready to persist to ``scraped_rates``."""

    competitor_id: UUID
    stay_date: date
    price: Decimal
    currency: str


class SearchScraper(ABC):
    """Abstract base for per-OTA search-page scrapers. Pure — no I/O here."""

    #: Registry key and `scrape_runs.source` value.
    name: ClassVar[str]

    #: False = registered so the gap is explicit in job results, but the
    #: orchestrator skips it (e.g. Airbnb needs a browser-based fetcher).
    implemented: ClassVar[bool] = True

    def __init__(self, *, currency: str = "RON") -> None:
        #: Display currency requested from the source; parsers still read the
        #: currency actually shown on the page (never guess money).
        self.currency = currency

    @abstractmethod
    def plan_request(self, city: str, stay_date: date, *, page: int = 0) -> PlannedRequest:
        """Build the search-results request for one city, stay date, and result page."""

    @abstractmethod
    def parse_listings(self, html: str) -> list[ListingRate]:
        """Extract listings from a search-results page."""

    def identity_of(self, url: str | None) -> str | None:
        """Stable listing identity for slug-matching; None when the source has none."""
        return None
