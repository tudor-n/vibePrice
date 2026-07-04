"""Unit tests (no DB) for the demo seeder's deterministic building blocks."""

import random
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from pricepilot.demo.seed import (
    COMPETITOR_PROFILES,
    SEED_DAYS,
    event_bump_pct,
    price_for,
    rate_row_id,
)
from pricepilot.ingest.events import EventRecord

FITS = EventRecord(
    city="sibiu",
    name="FITS (Sibiu International Theatre Festival)",
    start_date=date(2026, 6, 12),
    end_date=date(2026, 6, 21),
    impact_score=90,
)


def test_seed_days_covers_contract_window() -> None:
    assert SEED_DAYS == 120


def test_rate_row_id_is_deterministic() -> None:
    profile = COMPETITOR_PROFILES[0]
    stay = date(2026, 7, 10)
    assert rate_row_id(profile.competitor_id, stay) == rate_row_id(profile.competitor_id, stay)


def test_rate_row_id_differs_per_competitor_and_date() -> None:
    ramada, imparatul = COMPETITOR_PROFILES[0], COMPETITOR_PROFILES[1]
    stay = date(2026, 7, 10)
    ids = {
        rate_row_id(ramada.competitor_id, stay),
        rate_row_id(imparatul.competitor_id, stay),
        rate_row_id(ramada.competitor_id, date(2026, 7, 11)),
    }
    assert len(ids) == 3


def test_event_bump_pct_scales_with_impact_score() -> None:
    inside = date(2026, 6, 15)
    assert event_bump_pct([FITS], inside) == Decimal("19")  # 10 + 90/10
    assert event_bump_pct([FITS], date(2026, 6, 22)) == Decimal("0")  # day after
    # Bounds of the contract: +10-20%.
    low = EventRecord("sibiu", "tiny", inside, inside, impact_score=0)
    high = EventRecord("sibiu", "huge", inside, inside, impact_score=100)
    assert event_bump_pct([low], inside) == Decimal("10")
    assert event_bump_pct([high], inside) == Decimal("20")


def test_price_for_is_decimal_deterministic_and_in_range() -> None:
    profile = COMPETITOR_PROFILES[2]  # Casa Luxemburg 300-370
    monday = date(2026, 7, 6)
    price = price_for(profile, monday, [])
    assert isinstance(price, Decimal)
    assert price == price_for(profile, monday, [])  # deterministic
    assert Decimal(profile.min_price) <= price <= Decimal(profile.max_price)
    assert price == price.quantize(Decimal("0.01"))


def test_price_for_weekend_bump_follows_seeded_rng_protocol() -> None:
    """The per-(competitor, stay_date) seeding IS the idempotency contract."""
    profile = COMPETITOR_PROFILES[2]
    friday = date(2026, 7, 10)
    rng = random.Random(f"demo-rates|{profile.competitor_id}|{friday.isoformat()}")
    base = Decimal(rng.randint(profile.min_price, profile.max_price))
    weekend_pct = Decimal(rng.randint(8, 15))
    expected = (base * (Decimal("1") + weekend_pct / Decimal("100"))).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    assert price_for(profile, friday, []) == expected


def test_price_for_event_bump_raises_price() -> None:
    profile = COMPETITOR_PROFILES[0]
    tuesday_in_fits = date(2026, 6, 16)
    with_event = price_for(profile, tuesday_in_fits, [FITS])
    without_event = price_for(profile, tuesday_in_fits, [])
    # Same seeded base; FITS adds exactly +19% on a weekday.
    expected = (without_event * Decimal("1.19")).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    assert with_event == expected
