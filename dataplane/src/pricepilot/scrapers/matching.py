"""Match search-page listings to a property's competitors by name (pure).

City-search scraping (ADR 0004) returns every hotel in town; the only key we
have to attribute a card to a competitor row is its display name. Matching is
deliberately conservative and deterministic:

* normalize: casefold → strip diacritics (NFKD) → punctuation to spaces →
  collapse whitespace;
* *significant* tokens drop generic hospitality words and the city name, so
  "Hotel Ramada Sibiu" can meet "Ramada by Wyndham Sibiu" on ``{ramada}``;
* exact normalized equality always wins; otherwise one side's significant
  tokens must be a subset of the other's; best = largest overlap, ties break
  alphabetically. Competitors that never match are reported per run so the
  owner can fix the name — never guessed.
"""

import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from pricepilot.scrapers.base import ListingRate

#: Generic hospitality tokens that carry no identity.
STOPWORDS = frozenset(
    {
        "hotel",
        "hostel",
        "pension",
        "pensiune",
        "pensiunea",
        "guesthouse",
        "apartments",
        "apartment",
        "aparthotel",
        "boutique",
        "by",
        "the",
        "la",
    }
)


@dataclass(frozen=True)
class CompetitorRef:
    """The slice of a ``competitors`` row that matching needs."""

    id: UUID
    name: str


def normalize_name(name: str) -> str:
    """Casefold, strip diacritics, drop punctuation, collapse whitespace."""
    decomposed = unicodedata.normalize("NFKD", name.casefold())
    without_marks = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    alnum_only = "".join(ch if ch.isalnum() else " " for ch in without_marks)
    return " ".join(alnum_only.split())


def significant_tokens(name: str, city: str) -> frozenset[str]:
    """Identity-carrying tokens: normalized, minus stopwords and the city."""
    city_tokens = set(normalize_name(city).split())
    return frozenset(
        token
        for token in normalize_name(name).split()
        if token not in STOPWORDS and token not in city_tokens
    )


def match_listings(
    listings: Sequence[ListingRate],
    competitors: Sequence[CompetitorRef],
    city: str,
) -> dict[UUID, ListingRate]:
    """Choose at most one listing per competitor; omit competitors with no match."""
    matched: dict[UUID, ListingRate] = {}
    normalized_listings = [(listing, normalize_name(listing.name)) for listing in listings]

    for competitor in competitors:
        competitor_norm = normalize_name(competitor.name)
        exact = [
            listing
            for listing, listing_norm in normalized_listings
            if listing_norm == competitor_norm
        ]
        if exact:
            matched[competitor.id] = min(exact, key=lambda listing: listing.name)
            continue

        competitor_tokens = significant_tokens(competitor.name, city)
        if not competitor_tokens:
            continue  # a generic-only name may never fuzzy-match

        candidates: list[tuple[int, ListingRate]] = []
        for listing, _ in normalized_listings:
            listing_tokens = significant_tokens(listing.name, city)
            if not listing_tokens:
                continue
            if competitor_tokens <= listing_tokens or listing_tokens <= competitor_tokens:
                overlap = len(competitor_tokens & listing_tokens)
                candidates.append((overlap, listing))
        if candidates:
            best_overlap = max(overlap for overlap, _ in candidates)
            matched[competitor.id] = min(
                (listing for overlap, listing in candidates if overlap == best_overlap),
                key=lambda listing: listing.name,
            )
    return matched
