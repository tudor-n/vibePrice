"""Resolve a competitor to its Booking listing URL (pure).

Runs the same conservative :func:`match_listings` used at scrape time, but
against a *name-scoped* Booking search (high recall for one specific hotel).
The competitor is unlinked here (no ``source_url``), so matching uses the
significant-token name tier; the winning card's URL becomes the stored link.
Returns None when no card matches confidently — an honest "unlinked", never a
guess. Keeping the decision in one pure function makes it testable and, later,
correctable by a human.
"""

from collections.abc import Callable, Sequence

from pricepilot.scrapers.base import ListingRate
from pricepilot.scrapers.matching import CompetitorRef, match_listings


def resolve_competitor_link(
    cards: Sequence[ListingRate],
    competitor: CompetitorRef,
    city: str,
    *,
    identity_of: Callable[[str | None], str | None],
) -> str | None:
    """Return the Booking URL of the card that matches ``competitor``, or None."""
    matched = match_listings(cards, [competitor], city, identity_of=identity_of)
    listing = matched.get(competitor.id)
    return listing.url if listing is not None else None
