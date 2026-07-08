"""``PlaceCandidate``: one Google Places search/details result.

Money/coordinate discipline extends to geo + ratings: latitude, longitude and
rating are ``Decimal`` in computation. Floats appear only at ``to_dict()``,
the JSON boundary (mirrors ``engine/serialization.py::to_jsonable``) — see
``shared/contracts/place-candidates.md`` for the persisted shape.
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import Any


@dataclass(frozen=True)
class PlaceCandidate:
    place_id: str
    name: str
    formatted_address: str | None
    latitude: Decimal
    longitude: Decimal
    rating: Decimal | None
    rating_count: int | None

    def to_dict(self) -> dict[str, Any]:
        """JSON-ready (backend stores this array as place_candidates JSONB).

        Coordinates/rating cross the JSON boundary as numbers; Decimals are the
        source of truth (see engine/serialization). Floats live only here.
        """
        return {
            "place_id": self.place_id,
            "name": self.name,
            "formatted_address": self.formatted_address,
            "latitude": float(self.latitude),
            "longitude": float(self.longitude),
            "rating": None if self.rating is None else float(self.rating),
            "rating_count": self.rating_count,
        }
