"""Event impact: overlapping city events push prices up, scaled by impact score.

``adjustment_pct = impact_score / 7.5`` (quantized to 0.1), so a score-90 event
like FITS yields +12.0%. When several events overlap a stay date, the strongest
one sets the adjustment and all overlapping event ids are reported.
"""

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from pricepilot.engine.models import FactorResult, RuleContext
from pricepilot.ingest.events import EventRecord

RULE_NAME = "event_impact"

#: Divisor mapping impact_score (0-100) to a percentage: 90 -> +12.0%.
IMPACT_SCORE_DIVISOR = Decimal("7.5")


def _fmt(d: date) -> str:
    return f"{d:%b} {d.day}"


def apply(ctx: RuleContext) -> FactorResult:
    overlapping: list[EventRecord] = [
        e for e in ctx.events if e.start_date <= ctx.stay_date <= e.end_date
    ]
    if not overlapping:
        return FactorResult(
            rule=RULE_NAME,
            adjustment_pct=Decimal("0.0"),
            reason=f"No events in {ctx.city.title()} overlap {ctx.stay_date.isoformat()}.",
            extra={"event_ids": []},
        )

    top = max(overlapping, key=lambda e: e.impact_score)
    pct = (Decimal(top.impact_score) / IMPACT_SCORE_DIVISOR).quantize(
        Decimal("0.1"), rounding=ROUND_HALF_UP
    )
    return FactorResult(
        rule=RULE_NAME,
        adjustment_pct=pct,
        reason=(
            f"{top.name} (impact {top.impact_score}/100) runs "
            f"{_fmt(top.start_date)}-{_fmt(top.end_date)}."
        ),
        extra={"event_ids": [str(e.id) for e in overlapping if e.id is not None]},
    )
