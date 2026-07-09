"""PlacesProvider seam: FixtureAdapter (tests/demo) + GoogleAdapter parsing.

Repo hard rule: providers never hit live services in tests. GoogleAdapter's
HTTP goes through an injected ``http_get`` callable here — no test may make a
network call.
"""

from decimal import Decimal
from pathlib import Path

import pytest

import pricepilot.places
from pricepilot.places import PLACES_FIXTURE_DIR, PlaceCandidate, get_places_provider
from pricepilot.places.fixture import FixtureAdapter
from pricepilot.places.google import GoogleAdapter


def test_fixture_text_search_returns_candidates():
    provider = FixtureAdapter(PLACES_FIXTURE_DIR)
    results = provider.text_search("Continental Forum", city="sibiu")
    assert results[0].place_id
    assert isinstance(results[0].latitude, Decimal)
    assert results[0].rating is None or isinstance(results[0].rating, Decimal)


def test_google_adapter_parses_text_search_without_network():
    payload = (PLACES_FIXTURE_DIR / "text_search_continental.json").read_text()

    def fake_get(url: str) -> str:  # injected; no network
        return payload

    provider = GoogleAdapter(api_key="test", http_get=fake_get)
    results = provider.text_search("Continental Forum", city="sibiu")
    assert len(results) == 2
    assert results[0].rating == Decimal("4.4")


def test_fixture_nearby_returns_three_lodging_candidates():
    provider = FixtureAdapter(PLACES_FIXTURE_DIR)
    results = provider.nearby(Decimal("45.79"), Decimal("24.15"), radius_m=1500)
    assert len(results) == 3
    for candidate in results:
        assert isinstance(candidate.latitude, Decimal)
        assert isinstance(candidate.longitude, Decimal)
        # vicinity-only results fall back through formatted_address/vicinity
        assert candidate.formatted_address


def test_fixture_details_finds_candidate_by_place_id():
    provider = FixtureAdapter(PLACES_FIXTURE_DIR)
    first = provider.text_search("Continental Forum", city="sibiu")[0]
    found = provider.details(first.place_id)
    assert found.place_id == first.place_id
    assert found.name == first.name


def test_fixture_details_unknown_place_id_raises_key_error():
    provider = FixtureAdapter(PLACES_FIXTURE_DIR)
    with pytest.raises(KeyError):
        provider.details("does-not-exist")


def test_google_adapter_nearby_without_network():
    payload = (PLACES_FIXTURE_DIR / "nearby_lodging_sibiu.json").read_text()
    calls: list[str] = []

    def fake_get(url: str) -> str:  # injected; no network
        calls.append(url)
        return payload

    provider = GoogleAdapter(api_key="test", http_get=fake_get)
    results = provider.nearby(Decimal("45.79"), Decimal("24.15"), radius_m=1500)
    assert len(results) == 3
    assert all(isinstance(c.rating, Decimal) for c in results)
    assert len(calls) == 1
    assert "nearbysearch" in calls[0]


def test_google_adapter_details_without_network():
    payload = (PLACES_FIXTURE_DIR / "text_search_continental.json").read_text()
    body = __import__("json").loads(payload)
    details_payload = __import__("json").dumps({"result": body["results"][0]})

    def fake_get(url: str) -> str:  # injected; no network
        return details_payload

    provider = GoogleAdapter(api_key="test", http_get=fake_get)
    found = provider.details("ChIJZ8h5jP7ZskARW2nO8f2X1qY")
    assert found.name == "Hotel Continental Forum Sibiu"
    assert found.rating == Decimal("4.4")


def test_place_candidate_to_dict_uses_floats_at_json_boundary():
    candidate = PlaceCandidate(
        place_id="abc123",
        name="Test Hotel",
        formatted_address="Str. Example 1, Sibiu",
        latitude=Decimal("45.7907"),
        longitude=Decimal("24.1367"),
        rating=Decimal("4.4"),
        rating_count=1280,
    )
    payload = candidate.to_dict()
    assert payload["latitude"] == pytest.approx(45.7907)
    assert isinstance(payload["latitude"], float)
    assert payload["rating"] == pytest.approx(4.4)


def test_place_candidate_to_dict_handles_null_rating():
    candidate = PlaceCandidate(
        place_id="abc123",
        name="Test Hotel",
        formatted_address=None,
        latitude=Decimal("45.7907"),
        longitude=Decimal("24.1367"),
        rating=None,
        rating_count=None,
    )
    payload = candidate.to_dict()
    assert payload["rating"] is None
    assert payload["formatted_address"] is None


def test_get_places_provider_defaults_to_fixture_adapter():
    # Default settings (PLACES_PROVIDER unset) must never call live Google.
    provider = get_places_provider()
    assert isinstance(provider, FixtureAdapter)


def test_default_fixtures_ship_inside_the_installed_package():
    # The Docker image pip-installs the package WITHOUT the repo checkout, so
    # the default provider's fixture data must resolve inside the package —
    # a repo-layout-relative path 404s at runtime (resolve_place job crash).
    package_dir = Path(pricepilot.places.__file__).resolve().parent
    assert PLACES_FIXTURE_DIR.is_relative_to(package_dir)
    results = FixtureAdapter(PLACES_FIXTURE_DIR).text_search("Continental Forum", city="sibiu")
    assert results, "packaged fixtures must load without the tests/ tree"


def test_google_adapter_text_search_raises_on_non_ok_status():
    body = __import__("json").dumps(
        {"results": [], "status": "REQUEST_DENIED", "error_message": "API key invalid"}
    )

    def fake_get(url: str) -> str:  # injected; no network
        return body

    provider = GoogleAdapter(api_key="test", http_get=fake_get)
    with pytest.raises(RuntimeError, match="REQUEST_DENIED"):
        provider.text_search("Continental Forum", city="sibiu")


def test_google_adapter_text_search_zero_results_returns_empty_list():
    body = __import__("json").dumps({"results": [], "status": "ZERO_RESULTS"})

    def fake_get(url: str) -> str:  # injected; no network
        return body

    provider = GoogleAdapter(api_key="test", http_get=fake_get)
    assert provider.text_search("Nonexistent Hotel", city="sibiu") == []


def test_get_places_provider_google_without_key_raises(monkeypatch):
    from pricepilot import config

    config.get_settings.cache_clear()
    monkeypatch.setenv("PLACES_PROVIDER", "google")
    monkeypatch.delenv("GOOGLE_PLACES_API_KEY", raising=False)
    try:
        with pytest.raises(RuntimeError):
            get_places_provider()
    finally:
        config.get_settings.cache_clear()
