"""Pipeline arithmetic tests: exact Decimal math, floor rounding, min-price guard."""

from datetime import date
from decimal import Decimal
from uuid import uuid4

from conftest import make_ctx
from pricepilot.engine.models import FactorResult, RuleContext
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


def _fixed_rule(pct: str) -> object:
    def rule(ctx: RuleContext) -> FactorResult:
        return FactorResult(rule=f"fixed_{pct}", adjustment_pct=Decimal(pct), reason="test rule")

    return rule


def test_price_arithmetic_is_exact_decimal() -> None:
    # Tuesday Jun 16, FITS overlapping, 6 days out, no competitor data:
    # seasonality +5, event_impact +12, competitor 0, day_of_week 0, lead_time -2
    # 350 * 1.05 * 1.12 * 1.00 * 1.00 * 0.98 = 403.368 -> floor -> 403
    ctx = make_ctx(stay_date=date(2026, 6, 16), lead_days=6, events=[FITS])
    result = compute(ctx)
    assert result.recommended_price == Decimal("403")
    assert isinstance(result.recommended_price, Decimal)
    assert not result.floor_applied


def test_rounding_is_down_never_above_computed_cap() -> None:
    # 199 * 1.005 = 199.995 -> must round DOWN to 199, never up to 200.
    ctx = make_ctx(base_price=Decimal("199.00"))
    result = compute(ctx, rules=[_fixed_rule("0.5")])
    assert result.recommended_price == Decimal("199")


def test_zero_adjustments_return_base_price() -> None:
    ctx = make_ctx(base_price=Decimal("350.00"))
    result = compute(ctx, rules=[_fixed_rule("0")])
    assert result.recommended_price == Decimal("350")


def test_min_price_floor_guard() -> None:
    # A -50% adjustment would give 175; the 70%-of-base floor holds at 245.
    ctx = make_ctx(base_price=Decimal("350.00"))
    result = compute(ctx, rules=[_fixed_rule("-50")])
    assert result.recommended_price == Decimal("245")
    assert result.floor_applied


def test_floor_pct_is_configurable() -> None:
    ctx = make_ctx(base_price=Decimal("350.00"))
    result = compute(ctx, rules=[_fixed_rule("-50")], min_price_pct_of_base=Decimal("40"))
    assert result.recommended_price == Decimal("175")
    assert not result.floor_applied


def test_factors_complete_every_default_rule_present_with_reason() -> None:
    result = compute(make_ctx())
    rule_names = [f.rule for f in result.factors]
    assert rule_names == [
        "seasonality",
        "event_impact",
        "competitor_position",
        "day_of_week",
        "lead_time",
    ]
    for factor in result.factors:
        assert factor.reason.strip(), f"rule {factor.rule} has an empty reason"
        assert isinstance(factor.adjustment_pct, Decimal)
