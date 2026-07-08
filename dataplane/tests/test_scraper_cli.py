"""Capture / dry-run CLI behavior — fakes only, never the network or DB."""

from pathlib import Path
from uuid import uuid4

import pytest

import pricepilot.scrapers.capture as capture_module
import pricepilot.scrapers.run as run_module
from pricepilot.scrapers.client import ScraperBlockedError
from pricepilot.scrapers.matching import CompetitorRef


class FakeClient:
    def __init__(self, html: str) -> None:
        self.html = html
        self.urls: list[str] = []

    def get(self, url: str) -> str:
        self.urls.append(url)
        if isinstance(self.html, Exception):
            raise self.html
        return self.html

    def close(self) -> None:
        pass


class ForbiddenSession:
    """Dry runs must never touch the database."""

    def execute(self, *args, **kwargs):  # pragma: no cover - failure path
        raise AssertionError("dry run must not touch the DB")

    def close(self) -> None:
        pass


@pytest.fixture()
def search_html(fixtures_dir: Path) -> str:
    return (fixtures_dir / "booking_search_sibiu.html").read_text(encoding="utf-8")


def test_capture_saves_html_and_reports_parse_count(search_html, tmp_path, capsys):
    out = tmp_path / "captured.html"
    rc = capture_module.main(
        ["booking", "--city", "sibiu", "--checkin", "2026-08-07", "--out", str(out)],
        client=FakeClient(search_html),
    )
    assert rc == 0
    assert out.read_text(encoding="utf-8") == search_html
    stdout = capsys.readouterr().out
    assert "parsed 5 listings" in stdout
    assert "Ramada by Wyndham Sibiu" in stdout


def test_capture_zero_listings_warns_about_stale_selectors(tmp_path, capsys):
    out = tmp_path / "captured.html"
    rc = capture_module.main(
        ["booking", "--city", "sibiu", "--out", str(out)],
        client=FakeClient("<html><body>nothing here</body></html>"),
    )
    assert rc == 0
    assert "selectors are stale" in capsys.readouterr().out


def test_capture_blocked_reports_and_fails(tmp_path, capsys):
    rc = capture_module.main(
        ["booking", "--city", "sibiu", "--out", str(tmp_path / "x.html")],
        client=FakeClient(ScraperBlockedError("HTTP 403")),
    )
    assert rc == 3
    assert "blocked" in capsys.readouterr().err.lower()


def test_capture_unimplemented_source_fails_cleanly(tmp_path, capsys):
    rc = capture_module.main(
        ["airbnb", "--city", "sibiu", "--out", str(tmp_path / "x.html")],
        client=FakeClient("<html></html>"),
    )
    assert rc == 2
    assert "not implemented" in capsys.readouterr().err


def test_run_dry_run_prints_observations_and_never_writes(
    search_html, capsys, monkeypatch
):
    refs = [
        CompetitorRef(id=uuid4(), name="Hotel Ramada Sibiu"),
        CompetitorRef(id=uuid4(), name="Casa Luxemburg"),
    ]
    monkeypatch.setattr(
        run_module, "competitors_by_city", lambda session, **kwargs: {"sibiu": refs}
    )
    rc = run_module.main(
        ["--city", "sibiu", "--days", "2"],
        client=FakeClient(search_html),
        session_factory=ForbiddenSession,
    )
    assert rc == 0
    stdout = capsys.readouterr().out
    assert "Hotel Ramada Sibiu" in stdout
    assert "412" in stdout
    assert "DRY RUN" in stdout


def test_run_write_mode_delegates_to_scrape_city(search_html, capsys, monkeypatch):
    monkeypatch.setattr(
        run_module,
        "competitors_by_city",
        lambda session, **kwargs: {"sibiu": [CompetitorRef(id=uuid4(), name="X")]},
    )
    calls: list[dict] = []

    def fake_scrape_city(session, client, **kwargs):
        calls.append(kwargs)
        return {"rates_written": 5, "sources": {"booking": {"rates_written": 5}}}

    monkeypatch.setattr(run_module, "scrape_city", fake_scrape_city)
    rc = run_module.main(
        ["--city", "sibiu", "--days", "2", "--write"],
        client=FakeClient(search_html),
        session_factory=ForbiddenSession,
    )
    assert rc == 0
    assert len(calls) == 1
    assert calls[0]["city"] == "sibiu"
    assert "rates_written" in capsys.readouterr().out


def test_run_requires_a_scope():
    with pytest.raises(SystemExit) as excinfo:
        run_module.main([], client=FakeClient("x"), session_factory=ForbiddenSession)
    assert excinfo.value.code == 2


def test_run_empty_scope_reports_and_exits_nonzero(capsys, monkeypatch):
    monkeypatch.setattr(run_module, "competitors_by_city", lambda session, **kwargs: {})
    rc = run_module.main(
        ["--city", "atlantis"],
        client=FakeClient("x"),
        session_factory=ForbiddenSession,
    )
    assert rc == 1
    assert "no competitors" in capsys.readouterr().err.lower()
