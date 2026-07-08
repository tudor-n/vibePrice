"""Competitor↔listing name matching — pure, deterministic."""

from decimal import Decimal
from uuid import uuid4

from pricepilot.scrapers.base import ListingRate
from pricepilot.scrapers.matching import (
    CompetitorRef,
    match_listings,
    normalize_name,
    significant_tokens,
)


def listing(name: str) -> ListingRate:
    return ListingRate(name=name, price=Decimal("100"), currency="RON")


def test_normalize_strips_diacritics_case_and_punctuation() -> None:
    assert normalize_name("Hotel Împăratul Romanilor") == "hotel imparatul romanilor"
    assert normalize_name("  CASA   Luxemburg! ") == "casa luxemburg"
    assert normalize_name("Pensiunea Cetate-Veche, Sibiu") == "pensiunea cetate veche sibiu"


def test_significant_tokens_drop_stopwords_and_city() -> None:
    assert significant_tokens("Hotel Ramada Sibiu", "sibiu") == frozenset({"ramada"})
    assert significant_tokens("Casa Luxemburg", "sibiu") == frozenset({"casa", "luxemburg"})
    assert significant_tokens("The Boutique Aparthotel by Maria", "sibiu") == frozenset(
        {"maria"}
    )


def test_demo_competitors_match_realistic_booking_names() -> None:
    ramada = CompetitorRef(id=uuid4(), name="Hotel Ramada Sibiu")
    imparatul = CompetitorRef(id=uuid4(), name="Hotel Împăratul Romanilor")
    luxemburg = CompetitorRef(id=uuid4(), name="Casa Luxemburg")
    listings = [
        listing("Ramada by Wyndham Sibiu"),
        listing("Hotel Imparatul Romanilor"),  # no diacritics on the listing side
        listing("Casa Luxemburg"),
        listing("Golden Tulip Ana Tower"),
    ]

    matched = match_listings(listings, [ramada, imparatul, luxemburg], city="sibiu")

    assert matched[ramada.id].name == "Ramada by Wyndham Sibiu"
    assert matched[imparatul.id].name == "Hotel Imparatul Romanilor"
    assert matched[luxemburg.id].name == "Casa Luxemburg"


def test_exact_normalized_match_beats_token_subset() -> None:
    competitor = CompetitorRef(id=uuid4(), name="Casa Luxemburg")
    listings = [listing("Casa Luxemburg Residence"), listing("Casa Luxemburg")]
    matched = match_listings(listings, [competitor], city="sibiu")
    assert matched[competitor.id].name == "Casa Luxemburg"


def test_largest_token_overlap_wins() -> None:
    competitor = CompetitorRef(id=uuid4(), name="Hotel Golden Tulip Ana Tower")
    listings = [listing("Golden Tulip"), listing("Golden Tulip Ana Tower Sibiu")]
    matched = match_listings(listings, [competitor], city="sibiu")
    assert matched[competitor.id].name == "Golden Tulip Ana Tower Sibiu"


def test_overlap_tie_breaks_alphabetically() -> None:
    competitor = CompetitorRef(id=uuid4(), name="Casa Rozelor")
    # "boutique"/"apartments" are stopwords → both reduce to {casa, rozelor}.
    listings = [listing("Casa Rozelor Boutique"), listing("Casa Rozelor Apartments")]
    matched = match_listings(listings, [competitor], city="sibiu")
    assert matched[competitor.id].name == "Casa Rozelor Apartments"


def test_unmatched_competitor_is_absent_from_result() -> None:
    competitor = CompetitorRef(id=uuid4(), name="Vila Nicula")
    matched = match_listings([listing("Hotel Continental")], [competitor], city="sibiu")
    assert matched == {}


def test_generic_only_name_requires_exact_match() -> None:
    competitor = CompetitorRef(id=uuid4(), name="Hotel Sibiu")  # zero significant tokens
    assert match_listings([listing("Hotel Sibiu Palace")], [competitor], city="sibiu") == {}
    matched = match_listings([listing("Hotel Sibiu")], [competitor], city="sibiu")
    assert matched[competitor.id].name == "Hotel Sibiu"


def test_one_listing_may_serve_multiple_competitor_rows() -> None:
    # Two tenants track the same hotel — both rows get the rate.
    first = CompetitorRef(id=uuid4(), name="Casa Luxemburg")
    second = CompetitorRef(id=uuid4(), name="Casa Luxemburg Sibiu")
    matched = match_listings([listing("Casa Luxemburg")], [first, second], city="sibiu")
    assert matched[first.id].name == "Casa Luxemburg"
    assert matched[second.id].name == "Casa Luxemburg"
