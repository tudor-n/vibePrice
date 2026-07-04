"""Lead time curve.

The curve, by days until the stay date:

* ``lead_days < 7`` — LAST_MINUTE_ADJUSTMENT_PCT (-2.0%): slight discount to
  capture late bookers on rooms at risk of going empty.
* ``7 <= lead_days <= 60`` — 0%: the normal booking window; other rules decide.
* ``lead_days > 60`` — 0%: too far out to justify a lead-time move; a future
  version may add an early-bird premium here once own-booking history exists.
"""

from decimal import Decimal

from pricepilot.engine.models import FactorResult, RuleContext

RULE_NAME = "lead_time"

LAST_MINUTE_THRESHOLD_DAYS = 7
FAR_OUT_THRESHOLD_DAYS = 60
LAST_MINUTE_ADJUSTMENT_PCT = Decimal("-2.0")


def apply(ctx: RuleContext) -> FactorResult:
    if ctx.lead_days < LAST_MINUTE_THRESHOLD_DAYS:
        return FactorResult(
            rule=RULE_NAME,
            adjustment_pct=LAST_MINUTE_ADJUSTMENT_PCT,
            reason=(
                f"Stay is {ctx.lead_days} days out; "
                "slight discount to capture late bookers."
            ),
        )
    if ctx.lead_days > FAR_OUT_THRESHOLD_DAYS:
        return FactorResult(
            rule=RULE_NAME,
            adjustment_pct=Decimal("0.0"),
            reason=f"Stay is {ctx.lead_days} days out; too far out for a lead-time adjustment.",
        )
    return FactorResult(
        rule=RULE_NAME,
        adjustment_pct=Decimal("0.0"),
        reason=f"Stay is {ctx.lead_days} days out; within the normal booking window.",
    )
