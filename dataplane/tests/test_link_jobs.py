"""link_competitor_sources handler — fake session + fake client (no DB/network)."""

import uuid
from pathlib import Path

from sqlalchemy import Select
from sqlalchemy.sql.dml import Update

from pricepilot.scheduler.jobs import handle_link_competitor_sources

FIXTURES = Path(__file__).parent / "fixtures"


class FakeLinkSession:
    """Returns canned competitor rows for SELECTs; records UPDATEs."""

    def __init__(self, rows):
        self._rows = rows  # list of (id, name, tenant_id, city)
        self.statements = []
        self.commits = 0

    def execute(self, statement, *args, **kwargs):
        self.statements.append(statement)
        if isinstance(statement, Select):
            return list(self._rows)
        return statement

    def commit(self):
        self.commits += 1


class FakeClient:
    def __init__(self, html):
        self.html = html
        self.urls = []

    def get(self, url):
        self.urls.append(url)
        return self.html

    def close(self):
        pass


def _competitor_updates(session):
    return [
        s for s in session.statements if isinstance(s, Update) and s.table.name == "competitors"
    ]


def test_link_sets_source_url_for_matched_competitor():
    html = (FIXTURES / "booking_link_ramada.html").read_text(encoding="utf-8")
    comp_id = uuid.uuid4()
    session = FakeLinkSession([(comp_id, "Ramada by Wyndham Sibiu", uuid.uuid4(), "sibiu")])
    client = FakeClient(html)

    result = handle_link_competitor_sources(
        session, {"property_id": str(uuid.uuid4())}, client=client
    )

    assert result["linked"] == 1
    assert result["unlinked"] == 0
    updates = _competitor_updates(session)
    assert len(updates) == 1
    assert updates[0].compile().params["source_url"] == "https://www.booking.com/hotel/ro/ramada-sibiu.html"


def test_link_leaves_unmatched_competitor_unlinked():
    html = (FIXTURES / "booking_link_ramada.html").read_text(encoding="utf-8")
    session = FakeLinkSession([(uuid.uuid4(), "Nonexistent Guesthouse", uuid.uuid4(), "sibiu")])
    client = FakeClient(html)

    result = handle_link_competitor_sources(session, {"property_id": None}, client=client)

    assert result["linked"] == 0
    assert result["unlinked"] == 1
    assert _competitor_updates(session) == []
