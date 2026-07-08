"""Integration: the scrape job persists rates + runs against the dev DB.

The HTTP layer is always faked (fixture HTML / scripted errors) — tests never
touch live sites (repo hard rule). What is real here: Postgres, the demo
world's competitors, `scraped_rates` append-only inserts, and `scrape_runs`
bookkeeping.
"""

from datetime import date
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from dbprobe import DATABASE_URL, integration_marks
from demoworld import insert_backend_demo_rows
from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import Session

import pricepilot.scheduler.jobs as jobs_module
from pricepilot.config import Settings
from pricepilot.db.tables import ScrapedRate, ScrapeRun
from pricepilot.demo.seed import rate_row_id
from pricepilot.scheduler.jobs import handle_scrape_competitor_rates
from pricepilot.scrapers.client import ScraperBlockedError

pytestmark = integration_marks()

PROPERTY_ID = UUID("33333333-3333-4333-8333-333333333333")
DEMO_COMPETITOR_IDS = [
    UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
]
FIXTURE_HTML = (
    Path(__file__).parent.parent / "fixtures" / "booking_search_sibiu.html"
).read_text(encoding="utf-8")
DAYS = 3


class FakeClient:
    def __init__(self, html: str = FIXTURE_HTML) -> None:
        self.html = html
        self.urls: list[str] = []

    def get(self, url: str) -> str:
        self.urls.append(url)
        return self.html

    def close(self) -> None:  # orchestrator never closes injected clients; safety net
        pass


class BlockedClient:
    def get(self, url: str) -> str:
        raise ScraperBlockedError("HTTP 403 — likely anti-bot block")

    def close(self) -> None:
        pass


@pytest.fixture(scope="module")
def engine():
    engine = create_engine(DATABASE_URL)
    yield engine
    engine.dispose()


def _cleanup(session: Session) -> None:
    """Remove test-appended market rows; keep the demo seeder's uuid5 rows.

    `test_demo_seed_is_idempotent` counts exact seeded rows for these
    competitors, so everything this module appends must go.
    """
    rows = session.execute(
        select(ScrapedRate.id, ScrapedRate.competitor_id, ScrapedRate.stay_date).where(
            ScrapedRate.competitor_id.in_(DEMO_COMPETITOR_IDS)
        )
    ).all()
    appended = [
        row_id
        for row_id, competitor_id, stay_date in rows
        if row_id != rate_row_id(competitor_id, stay_date)
    ]
    if appended:
        session.execute(delete(ScrapedRate).where(ScrapedRate.id.in_(appended)))
    session.execute(delete(ScrapeRun).where(ScrapeRun.source == "booking"))
    session.commit()


@pytest.fixture()
def session(engine, monkeypatch):
    monkeypatch.setattr(
        jobs_module,
        "get_settings",
        lambda: Settings(
            scrape_sources="booking",
            scrape_days_ahead=DAYS,
            scrape_delay_seconds=0.0,
            scrape_currency="RON",
        ),
    )
    with Session(engine) as session:
        insert_backend_demo_rows(session)
        session.commit()
        _cleanup(session)  # stable ground truth even after crashed runs
        yield session
        _cleanup(session)


def _appended_rate_count(session: Session) -> int:
    rows = session.execute(
        select(ScrapedRate.id, ScrapedRate.competitor_id, ScrapedRate.stay_date).where(
            ScrapedRate.competitor_id.in_(DEMO_COMPETITOR_IDS)
        )
    ).all()
    return sum(
        1
        for row_id, competitor_id, stay_date in rows
        if row_id != rate_row_id(competitor_id, stay_date)
    )


def _booking_runs(session: Session) -> list[ScrapeRun]:
    return list(
        session.execute(select(ScrapeRun).where(ScrapeRun.source == "booking"))
        .scalars()
        .all()
    )


def test_property_scope_writes_rates_and_succeeded_run(session: Session) -> None:
    client = FakeClient()
    result = handle_scrape_competitor_rates(
        session, {"property_id": str(PROPERTY_ID), "city": None}, client=client
    )

    assert result["rates_written"] == 3 * DAYS  # 3 matched competitors × 3 dates
    booking_report = result["cities"]["sibiu"]["sources"]["booking"]
    assert booking_report["rates_written"] == 3 * DAYS
    assert booking_report["dates_fetched"] == DAYS
    assert booking_report["unmatched"] == []
    assert booking_report["error"] is None
    assert len(client.urls) == DAYS

    assert _appended_rate_count(session) == 3 * DAYS
    runs = _booking_runs(session)
    assert len(runs) == 1
    assert runs[0].status == "succeeded"
    assert runs[0].finished_at is not None
    assert runs[0].error is None

    # Append-only observations carry today's capture and real prices.
    prices = set(
        session.execute(
            select(ScrapedRate.price).where(
                ScrapedRate.competitor_id == DEMO_COMPETITOR_IDS[0],
                ScrapedRate.stay_date == date.today(),
                ScrapedRate.currency == "RON",
            )
        )
        .scalars()
        .all()
    )
    assert len(prices) >= 1


def test_rerun_appends_history_not_duplicates_conflict(session: Session) -> None:
    handle_scrape_competitor_rates(
        session, {"property_id": str(PROPERTY_ID)}, client=FakeClient()
    )
    handle_scrape_competitor_rates(
        session, {"property_id": str(PROPERTY_ID)}, client=FakeClient()
    )
    # Two capture sets: history is intentional, uuid4 ids never collide.
    assert _appended_rate_count(session) == 2 * 3 * DAYS
    assert len(_booking_runs(session)) == 2


def test_city_scope_is_case_insensitive(session: Session) -> None:
    result = handle_scrape_competitor_rates(
        session, {"city": "SIBIU", "property_id": None}, client=FakeClient()
    )
    assert result["rates_written"] == 3 * DAYS


def test_unknown_scope_writes_nothing_and_creates_no_run(session: Session) -> None:
    result = handle_scrape_competitor_rates(
        session, {"property_id": str(uuid4())}, client=FakeClient()
    )
    assert result == {
        "rates_written": 0,
        "note": "no competitors configured for this scope",
    }
    assert _booking_runs(session) == []
    assert _appended_rate_count(session) == 0


def test_blocked_everywhere_fails_run_and_job(session: Session) -> None:
    with pytest.raises(RuntimeError, match="wrote no rates"):
        handle_scrape_competitor_rates(
            session, {"property_id": str(PROPERTY_ID)}, client=BlockedClient()
        )
    runs = _booking_runs(session)
    assert len(runs) == 1
    assert runs[0].status == "failed"
    assert runs[0].error is not None and "blocked" in runs[0].error
    assert _appended_rate_count(session) == 0


def test_unimplemented_only_sources_skip_without_runs(session: Session, monkeypatch) -> None:
    monkeypatch.setattr(
        jobs_module,
        "get_settings",
        lambda: Settings(
            scrape_sources="airbnb",
            scrape_days_ahead=DAYS,
            scrape_delay_seconds=0.0,
            scrape_currency="RON",
        ),
    )
    result = handle_scrape_competitor_rates(
        session, {"property_id": str(PROPERTY_ID)}, client=FakeClient()
    )
    assert result["rates_written"] == 0
    assert result["cities"]["sibiu"]["sources"]["airbnb"] == {"skipped": "not implemented"}
    assert _booking_runs(session) == []
