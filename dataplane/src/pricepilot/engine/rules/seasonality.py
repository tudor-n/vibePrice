"""Seasonality baseline: a per-month percentage table (Sibiu defaults).

Positive months are high season, negative months are low season. The table is
configurable per city later; for v1 the Sibiu defaults apply everywhere.
"""

from decimal import Decimal

from pricepilot.engine.models import FactorResult, RuleContext

RULE_NAME = "seasonality"

#: Month (1-12) -> adjustment percentage. Sibiu defaults: summer + December
#: (Christmas market) run high; deep winter runs low.
SIBIU_MONTH_ADJUSTMENT_PCT: dict[int, Decimal] = {
    1: Decimal("-5.0"),
    2: Decimal("-5.0"),
    3: Decimal("0.0"),
    4: Decimal("0.0"),
    5: Decimal("3.0"),
    6: Decimal("5.0"),
    7: Decimal("8.0"),
    8: Decimal("8.0"),
    9: Decimal("3.0"),
    10: Decimal("0.0"),
    11: Decimal("-3.0"),
    12: Decimal("6.0"),
}

_MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]  # fmt: skip


def apply(
    ctx: RuleContext,
    month_table: dict[int, Decimal] = SIBIU_MONTH_ADJUSTMENT_PCT,
) -> FactorResult:
    month = ctx.stay_date.month
    pct = month_table[month]
    month_name = _MONTH_NAMES[month - 1]
    city = ctx.city.title()

    if pct > 0:
        label = "high season"
    elif pct < 0:
        label = "low season"
    else:
        label = "shoulder season"
    reason = f"{month_name} is {label} in {city}"
    if ctx.avg_occupancy_by_month and month in ctx.avg_occupancy_by_month:
        occupancy_pct = round(ctx.avg_occupancy_by_month[month] * 100)
        reason += f" (avg occupancy {occupancy_pct}%)"
    reason += "."

    return FactorResult(rule=RULE_NAME, adjustment_pct=pct, reason=reason)
