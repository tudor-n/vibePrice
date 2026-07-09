"""PlacesProvider seam: swap Google/fixture without touching callers.

Later tasks (resolve_place / discover_competitors job handlers) import
``get_places_provider`` and ``PlaceCandidate`` from this package only.
"""

from pathlib import Path

from pricepilot.config import get_settings
from pricepilot.places.fixture import FixtureAdapter
from pricepilot.places.google import GoogleAdapter
from pricepilot.places.models import PlaceCandidate
from pricepilot.places.provider import PlacesProvider

# Demo fixtures ship inside the package (pyproject package-data): the Docker
# image pip-installs without the repo checkout, so any repo-relative path
# would not exist at runtime.
PLACES_FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"


def get_places_provider() -> PlacesProvider:
    settings = get_settings()
    if settings.places_provider == "google":
        if not settings.google_places_api_key:
            raise RuntimeError("PLACES_PROVIDER=google requires GOOGLE_PLACES_API_KEY")
        return GoogleAdapter(settings.google_places_api_key)
    return FixtureAdapter(PLACES_FIXTURE_DIR)


__all__ = ["PLACES_FIXTURE_DIR", "PlaceCandidate", "PlacesProvider", "get_places_provider"]
