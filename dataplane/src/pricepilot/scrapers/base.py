"""Scraper base types.

Every scraper is split into two steps:

* ``fetch`` — does network I/O (httpx, using ``Settings.scraper_user_agent`` and
  ``Settings.scraper_proxy_url``) and returns raw observations. Never exercised
  by tests — tests must use saved HTML fixtures only.
* ``parse`` — a pure function from HTML text to parsed rates, so it can be
  tested against fixture files in ``tests/fixtures/``.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID


@dataclass(frozen=True)
class ParsedRate:
    """A rate parsed from a page, before it is attributed to a competitor."""

    stay_date: date
    price: Decimal
    currency: str


@dataclass(frozen=True)
class RateObservation:
    """A competitor rate observation, ready to persist to ``scraped_rates``."""

    competitor_id: UUID
    stay_date: date
    price: Decimal
    currency: str


class BaseScraper(ABC):
    """Abstract base for per-OTA scrapers.

    Scrapers are fragile and ToS-gray by nature: keep each source isolated in
    its own module so it can be swapped for a paid rate API later without
    touching anything else.
    """

    #: Registry key and `scrape_runs.source` / `competitors.source` value.
    name: str

    @abstractmethod
    def parse(self, html: str) -> list[ParsedRate]:
        """Pure parsing step: extract rates from a saved/fetched HTML document."""

    @abstractmethod
    def fetch(self, source_url: str, stay_dates: list[date]) -> list[RateObservation]:
        """Fetch live rates for the given stay dates. Never called from tests."""
