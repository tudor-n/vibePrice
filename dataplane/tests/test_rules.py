"""Boundary tests for every engine rule. Rules are pure: ctx in, FactorResult out."""

from datetime import date
from decimal import Decimal
from uuid import uuid4

from conftest import make_ctx
from pricepilot.engine.rules import (
    RULES,
    competitor_position,
    day_of_week,
    event_impact,
    lead_time,
    seasonality,
)
from pricepilot.ingest.events import EventRecord

FITS = EventRecord(
    city="sibiu",
    name="FITS (Sibiu International Theatre Festival)",
    start_date=date(2026, 6, 12),
    end_date=date(2026, 6, 21),
    impact_score=90,
    id=uuid4(),
)


class TestSeasonality:
    def test_table_covers_all_twelve_months(self) -> None:
        assert set(seasonality.SIBIU_MONTH_ADJUSTMENT_PCT) == set(range(1, 13))

    def test_high_season_month_positive(self) -> None:
        result = seasonality.apply(make_ctx(stay_date=date(2026, 6, 16)))
        assert result.rule == "seasonality"
        assert result.adjustment_pct == Decimal("5.0")
        assert "June" in result.reason and "high season" in result.reason

    def test_low_season_month_negative(self) -> None:
        result = seasonality.apply(make_ctx(stay_date=date(2026, 1, 15)))
        assert result.adjustment_pct == Decimal("-5.0")
        assert "low season" in result.reason

    def test_shoulder_month_zero(self) -> None:
        result = seasonality.apply(make_ctx(stay_date=date(2026, 4, 15)))
        assert result.adjustment_pct == Decimal("0.0")

    def test_year_edge_months(self) -> None:
        january = seasonality.apply(make_ctx(stay_date=date(2026, 1, 1)))
        december = seasonality.apply(make_ctx(stay_date=date(2026, 12, 31)))
        assert january.adjustment_pct == Decimal("-5.0")
        assert december.adjustment_pct == Decimal("6.0")

    def test_occupancy_enriches_reason_when_available(self) -> None:
        ctx = make_ctx(stay_date=date(2026, 6, 16), avg_occupancy_by_month={6: 0.78})
        assert "78%" in seasonality.apply(ctx).reason


class TestEventImpact:
    def test_overlapping_event_scales_with_impact_score(self) -> None:
        result = event_impact.apply(make_ctx(stay_date=date(2026, 6, 15), events=[FITS]))
        assert result.rule == "event_impact"
        assert result.adjustment_pct == Decimal("12.0")  # score 90 -> +12%
        assert "FITS" in result.reason
        assert result.extra["event_ids"] == [str(FITS.id)]

    def test_event_boundaries_inclusive(self) -> None:
        first = event_impact.apply(make_ctx(stay_date=date(2026, 6, 12), events=[FITS]))
        last = event_impact.apply(make_ctx(stay_date=date(2026, 6, 21), events=[FITS]))
        assert first.adjustment_pct == Decimal("12.0")
        assert last.adjustment_pct == Decimal("12.0")

    def test_non_overlapping_event_is_zero(self) -> None:
        before = event_impact.apply(make_ctx(stay_date=date(2026, 6, 11), events=[FITS]))
        after = event_impact.apply(make_ctx(stay_date=date(2026, 6, 22), events=[FITS]))
        assert before.adjustment_pct == Decimal("0.0")
        assert after.adjustment_pct == Decimal("0.0")
        assert before.extra["event_ids"] == []

    def test_strongest_of_multiple_overlapping_events_wins(self) -> None:
        weaker = EventRecord(
            city="sibiu",
            name="Craft fair",
            start_date=date(2026, 6, 14),
            end_date=date(2026, 6, 16),
            impact_score=30,
            id=uuid4(),
        )
        result = event_impact.apply(
            make_ctx(stay_date=date(2026, 6, 15), events=[weaker, FITS])
        )
        assert result.adjustment_pct == Decimal("12.0")
        assert "FITS" in result.reason
        assert set(result.extra["event_ids"]) == {str(weaker.id), str(FITS.id)}


class TestCompetitorPosition:
    def test_no_data_returns_zero_with_reason_and_sample_size(self) -> None:
        result = competitor_position.apply(make_ctx(competitor_rates=[]))
        assert result.rule == "competitor_position"
        assert result.adjustment_pct == Decimal("0.0")
        assert "No competitor rates" in result.reason
        assert result.extra["sample_size"] == 0
        # Contract v2: the band exists iff sample_size > 0.
        assert "band_low" not in result.extra
        assert "band_high" not in result.extra

    def test_market_at_current_price_is_zero(self) -> None:
        rates = [Decimal("300.00"), Decimal("350.00"), Decimal("400.00")]
        result = competitor_position.apply(make_ctx(competitor_rates=rates))
        assert result.adjustment_pct == Decimal("0.0")
        assert result.extra["sample_size"] == 3

    def test_band_carries_market_min_and_max(self) -> None:
        rates = [Decimal("300.00"), Decimal("350.00"), Decimal("400.00")]
        result = competitor_position.apply(make_ctx(competitor_rates=rates))
        assert result.extra["band_low"] == Decimal("300.00")
        assert result.extra["band_high"] == Decimal("400.00")
        assert isinstance(result.extra["band_low"], Decimal)  # money is never float
        assert isinstance(result.extra["band_high"], Decimal)

    def test_moves_halfway_toward_market(self) -> None:
        # median 420 vs current 350: gap +20%, half the gap = +10.0%
        rates = [Decimal("400.00"), Decimal("420.00"), Decimal("440.00")]
        result = competitor_position.apply(make_ctx(competitor_rates=rates))
        assert result.adjustment_pct == Decimal("10.0")

    def test_adjustment_is_bounded(self) -> None:
        way_up = competitor_position.apply(make_ctx(competitor_rates=[Decimal("700.00")] * 5))
        way_down = competitor_position.apply(make_ctx(competitor_rates=[Decimal("100.00")] * 5))
        assert way_up.adjustment_pct == Decimal("10.0")
        assert way_down.adjustment_pct == Decimal("-10.0")


class TestDayOfWeek:
    def test_friday_and_saturday_get_uplift(self) -> None:
        friday = day_of_week.apply(make_ctx(stay_date=date(2026, 6, 12)))
        saturday = day_of_week.apply(make_ctx(stay_date=date(2026, 6, 13)))
        assert friday.adjustment_pct == Decimal("4.0")
        assert saturday.adjustment_pct == Decimal("4.0")
        assert "Friday" in friday.reason

    def test_tuesday_and_sunday_are_zero(self) -> None:
        tuesday = day_of_week.apply(make_ctx(stay_date=date(2026, 6, 16)))
        sunday = day_of_week.apply(make_ctx(stay_date=date(2026, 6, 14)))
        assert tuesday.adjustment_pct == Decimal("0.0")
        assert "Tuesday" in tuesday.reason
        assert sunday.adjustment_pct == Decimal("0.0")


class TestLeadTime:
    def test_last_minute_boundary(self) -> None:
        six_days = lead_time.apply(make_ctx(lead_days=6))
        seven_days = lead_time.apply(make_ctx(lead_days=7))
        assert six_days.adjustment_pct == Decimal("-2.0")
        assert "late bookers" in six_days.reason
        assert seven_days.adjustment_pct == Decimal("0.0")

    def test_far_out_boundary(self) -> None:
        sixty = lead_time.apply(make_ctx(lead_days=60))
        sixty_one = lead_time.apply(make_ctx(lead_days=61))
        assert sixty.adjustment_pct == Decimal("0.0")
        assert sixty_one.adjustment_pct == Decimal("0.0")

    def test_same_day(self) -> None:
        assert lead_time.apply(make_ctx(lead_days=0)).adjustment_pct == Decimal("-2.0")


def test_rules_registry_is_ordered_and_complete() -> None:
    ctx = make_ctx()
    names = [rule(ctx).rule for rule in RULES]
    assert names == [
        "seasonality",
        "event_impact",
        "competitor_position",
        "day_of_week",
        "lead_time",
    ]


def test_every_rule_returns_decimal_adjustment_and_reason() -> None:
    ctx = make_ctx()
    for rule in RULES:
        result = rule(ctx)
        assert isinstance(result.adjustment_pct, Decimal)
        assert result.reason.strip()
