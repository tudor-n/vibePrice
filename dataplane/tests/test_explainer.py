"""The factors payload must match shared/contracts/recommendation-factors.md exactly."""

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import uuid4

from conftest import make_ctx
from pricepilot.engine.explainer import build_factors_payload
from pricepilot.engine.pipeline import compute
from pricepilot.ingest.events import EventRecord

FITS = EventRecord(
    city="sibiu",
    name="FITS (Sibiu International Theatre Festival)",
    start_date=date(2026, 6, 12),
    end_date=date(2026, 6, 21),
    impact_score=90,
    id=uuid4(),
)


def _payload() -> dict:
    ctx = make_ctx(
        stay_date=date(2026, 6, 16),
        lead_days=6,
        events=[FITS],
        competitor_rates=[Decimal("400.00"), Decimal("420.00"), Decimal("440.00")],
        scraped_rates_at=datetime(2026, 6, 1, 4, 10, tzinfo=UTC),
        events_at=datetime(2026, 5, 30, 2, 0, tzinfo=UTC),
    )
    result = compute(ctx)
    return build_factors_payload(
        ctx,
        result,
        period_start=date(2026, 6, 12),
        period_end=date(2026, 6, 21),
    )


def test_top_level_keys_match_contract() -> None:
    payload = _payload()
    assert set(payload) == {
        "engine_version",
        "base_price",
        "currency",
        "factors",
        "recommended_price",
        "expected_impact",
        "data_freshness",
    }


def test_engine_version_is_2() -> None:
    # v2: competitor_position carries band_low/band_high (contract changelog).
    assert _payload()["engine_version"] == "2"


def test_money_fields_are_decimal_never_float() -> None:
    payload = _payload()
    assert isinstance(payload["base_price"], Decimal)
    assert isinstance(payload["recommended_price"], Decimal)
    assert isinstance(payload["expected_impact"]["estimate"], Decimal)
    for factor in payload["factors"]:
        assert isinstance(factor["adjustment_pct"], Decimal)


def test_every_factor_has_rule_adjustment_and_reason() -> None:
    payload = _payload()
    assert [f["rule"] for f in payload["factors"]] == [
        "seasonality",
        "event_impact",
        "competitor_position",
        "day_of_week",
        "lead_time",
    ]
    for factor in payload["factors"]:
        assert {"rule", "adjustment_pct", "reason"} <= set(factor)
        assert factor["reason"].strip()


def test_rule_specific_extras_are_included() -> None:
    factors = {f["rule"]: f for f in _payload()["factors"]}
    assert factors["event_impact"]["event_ids"] == [str(FITS.id)]
    assert factors["competitor_position"]["sample_size"] == 3
    assert factors["competitor_position"]["band_low"] == Decimal("400.00")
    assert factors["competitor_position"]["band_high"] == Decimal("440.00")


def test_expected_impact_block() -> None:
    payload = _payload()
    impact = payload["expected_impact"]
    assert set(impact) == {"estimate", "currency", "period_start", "period_end", "method"}
    assert impact["currency"] == "RON"
    assert impact["period_start"] == "2026-06-12"
    assert impact["period_end"] == "2026-06-21"
    assert impact["method"] == "occupancy-weighted delta vs current price"
    # occupancy-weighted delta stub: (recommended - current) * nights * 0.70
    nights = Decimal("10")
    expected = (payload["recommended_price"] - Decimal("350.00")) * nights * Decimal("0.70")
    assert impact["estimate"] == expected.quantize(Decimal("0.01"))


def test_data_freshness_block_is_utc_iso_z() -> None:
    freshness = _payload()["data_freshness"]
    assert set(freshness) == {"scraped_rates_at", "events_at"}
    assert freshness["scraped_rates_at"] == "2026-06-01T04:10:00Z"
    assert freshness["events_at"] == "2026-05-30T02:00:00Z"


def test_data_freshness_tolerates_missing_timestamps() -> None:
    ctx = make_ctx()
    payload = build_factors_payload(ctx, compute(ctx))
    assert payload["data_freshness"]["scraped_rates_at"] is None
    assert payload["data_freshness"]["events_at"] is None


def test_recommended_price_matches_factor_arithmetic_cap() -> None:
    payload = _payload()
    multiplier = Decimal("1")
    for factor in payload["factors"]:
        multiplier *= Decimal("1") + factor["adjustment_pct"] / Decimal("100")
    cap = payload["base_price"] * multiplier
    assert payload["recommended_price"] <= cap  # rounded DOWN, never above the cap
