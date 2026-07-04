"""Day-of-week pattern: small weekend uplift on Friday/Saturday nights."""

from decimal import Decimal

from pricepilot.engine.models import FactorResult, RuleContext

RULE_NAME = "day_of_week"

WEEKEND_ADJUSTMENT_PCT = Decimal("4.0")
#: ``date.weekday()`` values for Friday and Saturday nights.
_WEEKEND_DAYS = {4, 5}


def apply(ctx: RuleContext) -> FactorResult:
    day_name = f"{ctx.stay_date:%A}"
    if ctx.stay_date.weekday() in _WEEKEND_DAYS:
        return FactorResult(
            rule=RULE_NAME,
            adjustment_pct=WEEKEND_ADJUSTMENT_PCT,
            reason=f"{day_name} night: weekend demand uplift.",
        )
    return FactorResult(
        rule=RULE_NAME,
        adjustment_pct=Decimal("0.0"),
        reason=f"{day_name}: no weekday adjustment.",
    )
