"""Fixture-backed ``PlacesProvider`` — tests + demo. Never calls live Google.

Deterministic: ``text_search`` always returns the canonical demo hotel
fixture; ``nearby`` reads ``nearby_<kind>_sibiu.json``.
"""

import json
from decimal import Decimal
from pathlib import Path

from pricepilot.places.models import PlaceCandidate
from pricepilot.places.provider import candidate_from_google_result


class FixtureAdapter:
    def __init__(self, fixture_dir: Path):
        self._dir = Path(fixture_dir)

    def _load(self, filename: str) -> list[PlaceCandidate]:
        body = json.loads((self._dir / filename).read_text(encoding="utf-8"))
        return [candidate_from_google_result(r) for r in body.get("results", [])]

    def text_search(self, query: str, *, city: str) -> list[PlaceCandidate]:
        # Single canonical fixture for the demo hotel; deterministic.
        return self._load("text_search_continental.json")

    def nearby(self, lat: Decimal, lng: Decimal, *, radius_m: int,
               kind: str = "lodging") -> list[PlaceCandidate]:
        return self._load(f"nearby_{kind}_sibiu.json")

    def details(self, place_id: str) -> PlaceCandidate:
        for c in self._load("text_search_continental.json"):
            if c.place_id == place_id:
                return c
        raise KeyError(place_id)
