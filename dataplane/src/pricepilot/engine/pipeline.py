"""Pricing pipeline: apply all rules and combine adjustments into one price.

``recommended_price = base_price × Π(1 + adjustment_pct/100)``, then rounded
DOWN to whole currency units (RON contract rule: never above the computed cap),
then clamped to a minimum-price floor (a configurable percentage of the base
price) so stacked negative adjustments can never give rooms away.
"""

from dataclasses import dataclass
from decimal import ROUND_FLOOR, Decimal

from pricepilot.engine.models import FactorResult, RuleContext
from pricepilot.engine.rules import RULES, Rule

#: Never recommend below this percentage of the base price.
MIN_PRICE_PCT_OF_BASE = Decimal("70")

_ONE_HUNDRED = Decimal("100")
_WHOLE_UNIT = Decimal("1")


@dataclass(frozen=True)
class PricingResult:
    """A computed recommendation: the price and the complete reasoning trail."""

    recommended_price: Decimal
    factors: list[FactorResult]
    floor_applied: bool


def compute(
    ctx: RuleContext,
    rules: list[Rule] = RULES,
    min_price_pct_of_base: Decimal = MIN_PRICE_PCT_OF_BASE,
) -> PricingResult:
    """Run every rule over ``ctx`` and combine the adjustments into a price."""
    factors = [rule(ctx) for rule in rules]

    multiplier = Decimal("1")
    for factor in factors:
        multiplier *= Decimal("1") + factor.adjustment_pct / _ONE_HUNDRED

    raw_price = ctx.base_price * multiplier
    # Round DOWN to whole currency units — never above the computed cap.
    price = raw_price.quantize(_WHOLE_UNIT, rounding=ROUND_FLOOR)

    floor = (ctx.base_price * min_price_pct_of_base / _ONE_HUNDRED).quantize(
        _WHOLE_UNIT, rounding=ROUND_FLOOR
    )
    floor_applied = price < floor
    if floor_applied:
        price = floor

    return PricingResult(recommended_price=price, factors=factors, floor_applied=floor_applied)
