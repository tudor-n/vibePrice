"""resolve_place job handler — fake session + fake provider (no DB, no network)."""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy.sql.dml import Insert, Update

from pricepilot.db.tables import Property
from pricepilot.places.models import PlaceCandidate
from pricepilot.scheduler.jobs import PLACE_CANDIDATE_LIMIT, handle_resolve_place


class FakeProvider:
    """Records the text_search call args; returns a canned result list."""

    def __init__(self, results: list[PlaceCandidate]) -> None:
        self._results = results
        self.calls: list[tuple[str, str]] = []

    def text_search(self, query: str, *, city: str) -> list[PlaceCandidate]:
        self.calls.append((query, city))
        return self._results

    def nearby(self, *args, **kwargs):  # pragma: no cover - not exercised here
        return []

    def details(self, place_id):  # pragma: no cover - not exercised here
        raise KeyError(place_id)


class FakeSession:
    """Minimal Session stand-in: session.get for one Property + a statement log."""

    def __init__(self, property_row: Property | None) -> None:
        self._property = property_row
        self.statements: list[object] = []
        self.commits = 0

    def get(self, model, id_):
        if model is Property and self._property is not None and self._property.id == id_:
            return self._property
        return None

    def execute(self, statement, *args, **kwargs):
        self.statements.append(statement)
        return statement

    def commit(self):
        self.commits += 1


def make_property(**overrides) -> Property:
    prop = Property(
        id=overrides.pop("id", uuid4()),
        tenant_id=uuid4(),
        name=overrides.pop("name", "Hotel X"),
        city=overrides.pop("city", "sibiu"),
        created_at=datetime.now(UTC),
    )
    for key, value in overrides.items():
        setattr(prop, key, value)
    return prop


def _updates_of(session: FakeSession, table_name: str) -> list[Update]:
    return [
        s for s in session.statements if isinstance(s, Update) and s.table.name == table_name
    ]


def _inserts_of(session: FakeSession, table_name: str) -> list[Insert]:
    return [
        s for s in session.statements if isinstance(s, Insert) and s.table.name == table_name
    ]


def test_resolve_writes_place_fields_and_enqueues_discovery():
    prop = make_property(name="Hotel X", city="sibiu")
    session = FakeSession(prop)
    provider = FakeProvider(
        [
            PlaceCandidate(
                "ChIJ1",
                "Hotel X",
                "Str. 1",
                Decimal("45.79"),
                Decimal("24.15"),
                Decimal("4.4"),
                1280,
            ),
            PlaceCandidate(
                "ChIJ2",
                "Hotel Y",
                "Str. 2",
                Decimal("45.80"),
                Decimal("24.16"),
                Decimal("4.1"),
                300,
            ),
        ]
    )

    result = handle_resolve_place(session, {"property_id": str(prop.id)}, provider=provider)

    assert result == {
        "property_id": str(prop.id),
        "resolved": True,
        "place_id": "ChIJ1",
        "candidate_count": 2,
    }

    # provider called with the property's name + city (no query override given)
    assert provider.calls == [("Hotel X", "sibiu")]

    # one Property update, one Job insert (discover_competitors enqueued)
    property_updates = _updates_of(session, "properties")
    job_inserts = _inserts_of(session, "jobs")
    assert len(property_updates) == 1
    assert len(job_inserts) == 1

    update_params = property_updates[0].compile().params
    assert update_params["place_id"] == "ChIJ1"
    assert update_params["latitude"] == Decimal("45.79")
    assert update_params["longitude"] == Decimal("24.15")
    assert update_params["rating"] == Decimal("4.4")
    assert update_params["rating_count"] == 1280
    assert update_params["place_candidates"] == [c.to_dict() for c in provider._results[:2]]

    job_params = job_inserts[0].compile().params
    assert job_params["type"] == "discover_competitors"
    assert job_params["payload"] == {"property_id": str(prop.id)}
    assert job_params["status"] == "queued"


def test_resolve_caps_candidates_at_five_and_honors_query_override():
    prop = make_property(name="Hotel X", city="sibiu")
    session = FakeSession(prop)
    candidates = [
        PlaceCandidate(
            f"ChIJ{i}", f"Hotel {i}", None, Decimal("45.79"), Decimal("24.15"), None, None
        )
        for i in range(7)
    ]
    provider = FakeProvider(candidates)

    result = handle_resolve_place(
        session, {"property_id": str(prop.id), "query": "Custom Search Text"}, provider=provider
    )

    assert result["resolved"] is True
    assert result["candidate_count"] == PLACE_CANDIDATE_LIMIT == 5
    assert provider.calls == [("Custom Search Text", "sibiu")]

    property_updates = _updates_of(session, "properties")
    stashed = property_updates[0].compile().params["place_candidates"]
    assert len(stashed) == 5
    assert stashed[0]["place_id"] == "ChIJ0"


def test_resolve_no_match_sets_failed_sentinel_and_enqueues_nothing():
    prop = make_property(name="Nonexistent Hotel", city="sibiu")
    session = FakeSession(prop)
    provider = FakeProvider([])

    result = handle_resolve_place(session, {"property_id": str(prop.id)}, provider=provider)

    assert result == {"resolved": False, "reason": "no match for 'Nonexistent Hotel'"}

    property_updates = _updates_of(session, "properties")
    job_inserts = _inserts_of(session, "jobs")
    assert len(property_updates) == 1
    assert len(job_inserts) == 0  # no discover_competitors enqueue on failure

    update_params = property_updates[0].compile().params
    assert update_params["place_candidates"] == "__failed__"
    assert update_params["place_resolved_at"] is None


def test_resolve_property_not_found_makes_no_writes():
    session = FakeSession(property_row=None)
    provider = FakeProvider([PlaceCandidate("X", "Y", None, Decimal(0), Decimal(0), None, None)])

    result = handle_resolve_place(
        session, {"property_id": str(uuid4())}, provider=provider
    )

    assert result == {"resolved": False, "reason": "property not found"}
    assert session.statements == []
    assert session.commits == 0
    assert provider.calls == []  # never reached the provider
