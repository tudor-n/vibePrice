"""Competitor position: move partway toward the median scraped competitor rate.

The adjustment is half the percentage gap between the median competitor rate
and the current price, bounded to ±MAX_ADJUSTMENT_PCT so one wild scrape can
never swing a price violently. With no data the rule contributes zero, with a
reason saying so (the dashboard shows this as a freshness problem, not silence).
"""

from decimal import ROUND_HALF_UP, Decimal
from statistics import median

from pricepilot.engine.models import FactorResult, RuleContext

RULE_NAME = "competitor_position"

MAX_ADJUSTMENT_PCT = Decimal("10.0")
#: Fraction of the market gap to close in one recommendation.
GAP_FRACTION = Decimal("0.5")


def apply(ctx: RuleContext) -> FactorResult:
    rates = ctx.competitor_rates
    if not rates:
        return FactorResult(
            rule=RULE_NAME,
            adjustment_pct=Decimal("0.0"),
            reason="No competitor rates scraped for this stay date; no market adjustment.",
            extra={"sample_size": 0},
        )

    market = median(rates)
    gap_pct = (market - ctx.current_price) / ctx.current_price * Decimal("100")
    pct = (gap_pct * GAP_FRACTION).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    pct = max(min(pct, MAX_ADJUSTMENT_PCT), -MAX_ADJUSTMENT_PCT)

    direction = "above" if market > ctx.current_price else "at or below"
    return FactorResult(
        rule=RULE_NAME,
        adjustment_pct=pct,
        reason=(
            f"Median of {len(rates)} tracked competitor rates is {market} {ctx.currency} "
            f"({direction} your {ctx.current_price} {ctx.currency}); "
            f"moving halfway toward market, capped at ±{MAX_ADJUSTMENT_PCT}%."
        ),
        extra={
            "sample_size": len(rates),
            # Contract v2: the market band the dashboard calendar renders.
            "band_low": min(rates),
            "band_high": max(rates),
        },
    )
