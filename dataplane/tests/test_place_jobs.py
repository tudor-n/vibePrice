"""resolve_place / discover_competitors job handlers — fake session + fake
provider (no DB, no network).
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import Select
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql.dml import Insert, Update

from pricepilot.config import get_settings
from pricepilot.db.tables import Competitor, Property
from pricepilot.places.models import PlaceCandidate
from pricepilot.scheduler.jobs import (
    DISCOVERY_NS,
    PLACE_CANDIDATE_LIMIT,
    handle_discover_competitors,
    handle_resolve_place,
)


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


class FakeNearby:
    """Records the nearby() call args; returns a canned candidate list."""

    def __init__(self, results: list[PlaceCandidate]) -> None:
        self._results = results
        self.calls: list[tuple[Decimal, Decimal, int, str]] = []

    def nearby(
        self, lat: Decimal, lng: Decimal, *, radius_m: int, kind: str = "lodging"
    ) -> list[PlaceCandidate]:
        self.calls.append((lat, lng, radius_m, kind))
        return self._results

    def text_search(self, *args, **kwargs):  # pragma: no cover - not exercised here
        raise AssertionError("discover_competitors must not call text_search")

    def details(self, place_id):  # pragma: no cover - not exercised here
        raise KeyError(place_id)


class FakeResult:
    """Stand-in for a ``session.execute(select(...))`` result: ``.scalars()`` only."""

    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def scalars(self):
        return list(self._rows)


class FakeSession:
    """Minimal Session stand-in: session.get for one Property + a statement log.

    ``existing_competitors`` seeds every SELECT's ``.scalars()`` result (the
    handler queries once, scoped to a single resolved property, so a flat list
    is enough to stand in for a real WHERE clause).
    """

    def __init__(
        self,
        property_row: Property | None,
        existing_competitors: list[Competitor] | None = None,
    ) -> None:
        self._property = property_row
        self._existing_competitors = existing_competitors or []
        self.statements: list[object] = []
        self.commits = 0

    def get(self, model, id_):
        if model is Property and self._property is not None and self._property.id == id_:
            return self._property
        return None

    def execute(self, statement, *args, **kwargs):
        self.statements.append(statement)
        if isinstance(statement, Select):
            return FakeResult(self._existing_competitors)
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


def make_competitor(**overrides) -> Competitor:
    comp = Competitor(
        id=overrides.pop("id", uuid4()),
        tenant_id=overrides.pop("tenant_id", uuid4()),
        property_id=overrides.pop("property_id", uuid4()),
        name=overrides.pop("name", "Old Hotel"),
        created_at=datetime.now(UTC),
    )
    for key, value in overrides.items():
        setattr(comp, key, value)
    return comp


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


# --------------------------------------------------------------------------
# discover_competitors
# --------------------------------------------------------------------------


def _competitor_insert_params(stmt: Insert) -> dict[str, object]:
    """Compile a pg_insert(...).on_conflict_do_update(...) statement.

    The default dialect can't compile ON CONFLICT — must use postgresql.
    """
    return stmt.compile(dialect=postgresql.dialect()).params


def test_discover_upserts_and_skips_self_and_tombstoned():
    prop = make_property(
        name="Hotel X", city="sibiu", place_id="ChIJ_self",
        latitude=Decimal("45.79"), longitude=Decimal("24.15"),
    )
    excluded = make_competitor(
        id=uuid.uuid5(DISCOVERY_NS, "ChIJ_excluded"),
        tenant_id=prop.tenant_id, property_id=prop.id,
        name="Old Hotel", place_id="ChIJ_excluded",
        excluded_at=datetime.now(UTC), discovery_source="google_nearby",
    )
    session = FakeSession(prop, existing_competitors=[excluded])
    provider = FakeNearby(
        [
            PlaceCandidate(
                "ChIJ_self", "Hotel X", None, Decimal("45.79"), Decimal("24.15"),
                Decimal("4.4"), 10,
            ),
            PlaceCandidate(
                "ChIJ_a", "Hotel A", None, Decimal("45.80"), Decimal("24.16"),
                Decimal("4.1"), 50,
            ),
            PlaceCandidate(
                "ChIJ_excluded", "Old Hotel", None, Decimal("45.81"), Decimal("24.17"),
                Decimal("3.9"), 20,
            ),
        ]
    )

    result = handle_discover_competitors(session, {"property_id": str(prop.id)}, provider=provider)

    assert result["property_id"] == str(prop.id)
    assert result["discovered"] == 1  # only Hotel A
    assert result["skipped_excluded"] == 1  # the tombstoned one
    assert result["capped"] == 0

    competitor_inserts = _inserts_of(session, "competitors")
    assert len(competitor_inserts) == 1
    params = _competitor_insert_params(competitor_inserts[0])
    assert params["place_id"] == "ChIJ_a"
    assert params["id"] == uuid.uuid5(DISCOVERY_NS, "ChIJ_a")
    assert params["tenant_id"] == prop.tenant_id
    assert params["name"] == "Hotel A"
    assert session.commits == 1

    # never re-added the self place or the tombstoned place
    inserted_place_ids = {_competitor_insert_params(s)["place_id"] for s in competitor_inserts}
    assert "ChIJ_self" not in inserted_place_ids
    assert "ChIJ_excluded" not in inserted_place_ids


def test_discover_caps_new_rows_at_configured_max():
    prop = make_property(
        name="Hotel X", city="sibiu", place_id="ChIJ_self",
        latitude=Decimal("45.79"), longitude=Decimal("24.15"),
    )
    session = FakeSession(prop)
    max_new = get_settings().competitor_discovery_max
    overflow = 5
    candidates = [
        PlaceCandidate(
            f"ChIJ_{i}", f"Hotel {i}", None, Decimal("45.80"), Decimal("24.16"),
            Decimal("4.0"), 10,
        )
        for i in range(max_new + overflow)
    ]
    provider = FakeNearby(candidates)

    result = handle_discover_competitors(session, {"property_id": str(prop.id)}, provider=provider)

    assert result["discovered"] == max_new
    assert result["capped"] == overflow
    assert result["skipped_excluded"] == 0
    assert len(_inserts_of(session, "competitors")) == max_new


def test_discover_unresolved_property_is_a_noop():
    prop = make_property(name="Hotel X", city="sibiu", place_id=None, latitude=None, longitude=None)
    session = FakeSession(prop)
    provider = FakeNearby([])

    result = handle_discover_competitors(session, {"property_id": str(prop.id)}, provider=provider)

    assert result["discovered"] == 0
    assert "reason" in result
    assert provider.calls == []  # nearby() never called
    assert _inserts_of(session, "competitors") == []
    assert session.commits == 0


def test_discover_existing_known_place_updates_not_new_and_keeps_uuid5_key():
    prop = make_property(
        name="Hotel X", city="sibiu", place_id="ChIJ_self",
        latitude=Decimal("45.79"), longitude=Decimal("24.15"),
    )
    known_id = uuid.uuid5(DISCOVERY_NS, "ChIJ_a")
    known = make_competitor(
        id=known_id, tenant_id=prop.tenant_id, property_id=prop.id,
        name="Hotel A (stale name)", place_id="ChIJ_a",
    )
    session = FakeSession(prop, existing_competitors=[known])
    provider = FakeNearby(
        [
            PlaceCandidate(
                "ChIJ_a", "Hotel A", None, Decimal("45.80"), Decimal("24.16"),
                Decimal("4.2"), 60,
            )
        ]
    )

    result = handle_discover_competitors(session, {"property_id": str(prop.id)}, provider=provider)

    # already known (not a tombstone) -> an update, not counted as newly discovered
    assert result["discovered"] == 0
    assert result["skipped_excluded"] == 0
    competitor_inserts = _inserts_of(session, "competitors")
    assert len(competitor_inserts) == 1
    params = _competitor_insert_params(competitor_inserts[0])
    assert params["id"] == known_id == uuid.uuid5(DISCOVERY_NS, "ChIJ_a")
    assert params["name"] == "Hotel A"  # refreshed from the fresh candidate
