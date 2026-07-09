"""Live Google Places adapter.

All HTTP goes through an injectable ``http_get`` (defaults to a plain
``httpx`` call) so tests can drive parsing with saved fixture JSON — the
repo hard rule that providers never hit live services in tests applies here.
"""

import json
from collections.abc import Callable
from decimal import Decimal
from urllib.parse import urlencode

from pricepilot.places.models import PlaceCandidate
from pricepilot.places.provider import candidate_from_google_result

_TEXT = "https://maps.googleapis.com/maps/api/place/textsearch/json"
_NEARBY = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
_DETAILS = "https://maps.googleapis.com/maps/api/place/details/json"


class GoogleAdapter:
    def __init__(self, api_key: str, *, http_get: Callable[[str], str] | None = None):
        self._key = api_key
        self._get = http_get or _default_get

    def text_search(self, query: str, *, city: str) -> list[PlaceCandidate]:
        url = f"{_TEXT}?{urlencode({'query': f'{query}, {city}', 'key': self._key})}"
        body = json.loads(self._get(url))
        return [candidate_from_google_result(r) for r in _results_or_raise(body)]

    def nearby(self, lat: Decimal, lng: Decimal, *, radius_m: int,
               kind: str = "lodging") -> list[PlaceCandidate]:
        params = {"location": f"{lat},{lng}", "radius": radius_m, "type": kind, "key": self._key}
        url = f"{_NEARBY}?{urlencode(params)}"
        body = json.loads(self._get(url))
        return [candidate_from_google_result(r) for r in _results_or_raise(body)]

    def details(self, place_id: str) -> PlaceCandidate:
        url = f"{_DETAILS}?{urlencode({'place_id': place_id, 'key': self._key})}"
        body = json.loads(self._get(url))
        return candidate_from_google_result(body["result"])


def _default_get(url: str) -> str:
    import httpx
    resp = httpx.get(url, timeout=20.0)
    resp.raise_for_status()
    return resp.text


def _results_or_raise(body: dict) -> list[dict]:
    """Return ``results`` for OK/ZERO_RESULTS; raise on any other Google status.

    Without this, an auth/quota failure (``REQUEST_DENIED``, ``OVER_QUERY_LIMIT``,
    ``INVALID_REQUEST``, ...) looks identical to a genuine empty result — a caller
    like ``resolve_place`` would then write a false "no match" outcome instead of
    letting the job fail and retry.
    """
    status = body.get("status", "OK")
    if status not in ("OK", "ZERO_RESULTS"):
        error_message = body.get("error_message")
        raise RuntimeError(f"Google Places error: {status}: {error_message}")
    return body.get("results", [])
