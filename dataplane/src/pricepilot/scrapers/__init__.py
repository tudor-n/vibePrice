"""Per-OTA scraper modules and the source-name registry.

Each source lives in its own module so it stays isolated and swappable
(e.g. for a paid rate API). Register new scrapers here by ``name``.
"""

from pricepilot.scrapers.airbnb import AirbnbScraper
from pricepilot.scrapers.base import BaseScraper
from pricepilot.scrapers.booking import BookingScraper

SCRAPERS: dict[str, type[BaseScraper]] = {
    BookingScraper.name: BookingScraper,
    AirbnbScraper.name: AirbnbScraper,
}
