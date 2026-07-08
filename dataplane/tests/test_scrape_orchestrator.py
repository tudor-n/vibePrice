"""Observation collection — fake client + saved fixture HTML, never the network."""

from datetime import date
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest

from pricepilot.scrapers.booking import BookingScraper
from pricepilot.scrapers.client import ScraperBlockedError, ScraperFetchError
from pricepilot.scrapers.matching import CompetitorRef
from pricepilot.scrapers.orchestrator import collect_source_observations

STAY_DATES = [date(2026, 8, 7), date(2026, 8, 8), date(2026, 8, 9)]


class FakeClient:
    """Returns scripted responses in order; exceptions in the script are raised."""

    def __init__(self, script: list[str | Exception]) -> None:
        self.script = list(script)
        self.urls: list[str] = []

    def get(self, url: str) -> str:
        self.urls.append(url)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.fixture()
def search_html(fixtures_dir: Path) -> str:
    return (fixtures_dir / "booking_search_sibiu.html").read_text(encoding="utf-8")


@pytest.fixture()
def competitors() -> list[CompetitorRef]:
    return [
        CompetitorRef(id=uuid4(), name="Hotel Ramada Sibiu"),
        CompetitorRef(id=uuid4(), name="Hotel Împăratul Romanilor"),
        CompetitorRef(id=uuid4(), name="Casa Luxemburg"),
    ]


def collect(client, competitors, stay_dates=STAY_DATES, currency="RON"):
    return collect_source_observations(
        BookingScraper(currency=currency),
        client,
        city="sibiu",
        competitors=competitors,
        stay_dates=stay_dates,
        expected_currency=currency,
    )


def test_happy_path_collects_matched_observations_per_date(search_html, competitors):
    client = FakeClient([search_html] * 3)
    outcome = collect(client, competitors)

    assert outcome.dates_fetched == 3
    assert outcome.dates_failed == 0
    assert outcome.blocked is False
    assert outcome.unmatched == []
    assert len(outcome.observations) == 3 * 3  # 3 competitors × 3 dates
    ramada = [
        o for o in outcome.observations if o.competitor_id == competitors[0].id
    ]
    assert [o.stay_date for o in ramada] == STAY_DATES
    assert all(o.price == Decimal("412") and o.currency == "RON" for o in ramada)
    # One request per stay date, each with its own checkin.
    assert len(client.urls) == 3
    assert "checkin=2026-08-07" in client.urls[0]
    assert "checkin=2026-08-09" in client.urls[2]


def test_blocked_aborts_remaining_dates_but_keeps_collected(search_html, competitors):
    client = FakeClient([search_html, ScraperBlockedError("HTTP 403")])
    outcome = collect(client, competitors)

    assert outcome.blocked is True
    assert outcome.dates_fetched == 1
    assert outcome.dates_failed == 2  # the blocked date + the aborted one
    assert len(outcome.observations) == 3  # from the one fetched date
    assert any("blocked" in issue for issue in outcome.issues)
    assert len(client.urls) == 2  # never asked for the third date


def test_transient_failure_skips_the_date_and_continues(search_html, competitors):
    client = FakeClient([search_html, ScraperFetchError("HTTP 500"), search_html])
    outcome = collect(client, competitors)

    assert outcome.blocked is False
    assert outcome.dates_fetched == 2
    assert outcome.dates_failed == 1
    assert len(outcome.observations) == 6
    assert any("HTTP 500" in issue for issue in outcome.issues)


def test_never_matched_competitors_are_reported(search_html):
    ghost = CompetitorRef(id=uuid4(), name="Vila Fantoma")
    client = FakeClient([search_html] * 3)
    outcome = collect(client, [ghost])
    assert outcome.unmatched == ["Vila Fantoma"]
    assert outcome.observations == []


def test_zero_fetched_dates_reports_no_unmatched(search_html, competitors):
    client = FakeClient([ScraperBlockedError("HTTP 429")])
    outcome = collect(client, competitors)
    assert outcome.dates_fetched == 0
    assert outcome.observations == []
    # No fetched pages = no evidence about names; the error text tells the story.
    assert outcome.unmatched == []


def test_currency_mismatch_drops_observation_with_issue(search_html):
    # Golden Tulip is priced in EUR in the fixture; the scrape expects RON.
    tulip = CompetitorRef(id=uuid4(), name="Hotel Golden Tulip Ana Tower")
    client = FakeClient([search_html])
    outcome = collect(client, [tulip], stay_dates=[STAY_DATES[0]])

    assert outcome.observations == []  # never persist money in the wrong currency
    assert any("currency mismatch" in issue for issue in outcome.issues)
    # Name matching itself worked — not an unmatched-name problem.
    assert outcome.unmatched == []
