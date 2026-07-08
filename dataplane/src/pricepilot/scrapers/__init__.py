"""Per-OTA scraper modules and the source-name registry.

Each source lives in its own module so it stays isolated and swappable
(e.g. for a paid rate API). Register new scrapers here by ``name``; sources
with ``implemented = False`` are skipped by the orchestrator but reported in
job results so the gap stays visible.
"""

from pricepilot.scrapers.airbnb import AirbnbScraper
from pricepilot.scrapers.base import SearchScraper
from pricepilot.scrapers.booking import BookingScraper

SCRAPERS: dict[str, type[SearchScraper]] = {
    BookingScraper.name: BookingScraper,
    AirbnbScraper.name: AirbnbScraper,
}
