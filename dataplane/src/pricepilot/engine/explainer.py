"""Build the `recommendations.factors` JSONB payload.

The shape is a cross-runtime contract — ``shared/contracts/recommendation-factors.md``.
Bump ``ENGINE_VERSION`` on any shape change and keep the dashboard renderer
backward-compatible.

Money values in the returned dict are ``Decimal`` (never float). When
persisting, serialize with a Decimal-aware JSON encoder (e.g. psycopg
``Jsonb(payload, dumps=...)``) so amounts stay exact JSON numbers.
"""

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from pricepilot.engine import ENGINE_VERSION
from pricepilot.engine.models import RuleContext
from pricepilot.engine.pipeline import PricingResult

#: Assumed nightly occupancy used by the expected-impact stub until real
#: occupancy data (own_bookings / INS) is ingested.
DEFAULT_ASSUMED_OCCUPANCY = Decimal("0.70")

EXPECTED_IMPACT_METHOD = "occupancy-weighted delta vs current price"


def _iso_utc(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def build_factors_payload(
    ctx: RuleContext,
    result: PricingResult,
    *,
    period_start: date | None = None,
    period_end: date | None = None,
    assumed_occupancy: Decimal = DEFAULT_ASSUMED_OCCUPANCY,
) -> dict[str, Any]:
    """Produce the factors JSON exactly as specified by the contract.

    ``expected_impact.estimate`` is an occupancy-weighted delta stub:
    ``(recommended - current) × nights × assumed_occupancy``. TODO: replace the
    assumed occupancy with observed occupancy once own_bookings/INS data lands.
    """
    start = period_start or ctx.stay_date
    end = period_end or ctx.stay_date
    nights = (end - start).days + 1

    estimate = (
        (result.recommended_price - ctx.current_price) * nights * assumed_occupancy
    ).quantize(Decimal("0.01"))

    factors: list[dict[str, Any]] = [
        {
            "rule": f.rule,
            "adjustment_pct": f.adjustment_pct,
            "reason": f.reason,
            **f.extra,
        }
        for f in result.factors
    ]

    return {
        "engine_version": ENGINE_VERSION,
        "base_price": ctx.base_price,
        "currency": ctx.currency,
        "factors": factors,
        "recommended_price": result.recommended_price,
        "expected_impact": {
            "estimate": estimate,
            "currency": ctx.currency,
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "method": EXPECTED_IMPACT_METHOD,
        },
        "data_freshness": {
            "scraped_rates_at": _iso_utc(ctx.scraped_rates_at),
            "events_at": _iso_utc(ctx.events_at),
        },
    }
