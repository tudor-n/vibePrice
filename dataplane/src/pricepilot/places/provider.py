"""``PlacesProvider`` Protocol + the shared Google-result parser.

Both adapters (``GoogleAdapter``, ``FixtureAdapter``) satisfy this Protocol so
callers (later tasks: resolve_place / discover_competitors job handlers) can
depend on the seam, not the concrete adapter.
"""

from decimal import Decimal
from typing import Protocol

from pricepilot.places.models import PlaceCandidate


class PlacesProvider(Protocol):
    def text_search(self, query: str, *, city: str) -> list[PlaceCandidate]: ...
    def details(self, place_id: str) -> PlaceCandidate: ...
    def nearby(self, lat: Decimal, lng: Decimal, *, radius_m: int,
               kind: str = "lodging") -> list[PlaceCandidate]: ...


def candidate_from_google_result(result: dict) -> PlaceCandidate:
    """Map one Google Places result object to a PlaceCandidate (pure)."""
    loc = result["geometry"]["location"]
    rating = result.get("rating")
    return PlaceCandidate(
        place_id=result["place_id"],
        name=result.get("name", ""),
        formatted_address=result.get("formatted_address") or result.get("vicinity"),
        latitude=Decimal(str(loc["lat"])),
        longitude=Decimal(str(loc["lng"])),
        rating=None if rating is None else Decimal(str(rating)),
        rating_count=result.get("user_ratings_total"),
    )
