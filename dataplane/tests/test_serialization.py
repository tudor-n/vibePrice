"""Decimal -> JSON boundary tests: 2dp round-trips must be lossless.

Contract decision (see ``pricepilot.engine.serialization``): floats appear
ONLY in the serialized JSON payload. Money is quantized to 2dp and converted
with ``float()``; for ``numeric(10,2)`` values (<= 99999999.99, i.e. <= 15
significant digits) ``Decimal -> float -> json -> Decimal`` is exact.
"""

import json
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from conftest import make_ctx
from pricepilot.engine.explainer import build_factors_payload
from pricepilot.engine.pipeline import compute
from pricepilot.engine.serialization import to_jsonable

REPRESENTATIVE_2DP_VALUES = [
    "0.01",
    "0.10",
    "-2.00",
    "17.50",
    "350.00",
    "413.00",
    "3400.00",
    "12345678.91",
    "99999999.99",  # numeric(10,2) maximum
]


@pytest.mark.parametrize("raw", REPRESENTATIVE_2DP_VALUES)
def test_two_dp_decimal_round_trips_losslessly_through_json(raw: str) -> None:
    original = Decimal(raw)
    dumped = json.dumps(to_jsonable(original))
    parsed = json.loads(dumped)
    assert isinstance(parsed, float)
    assert Decimal(str(parsed)) == original


def test_to_jsonable_recurses_and_quantizes_to_2dp() -> None:
    payload = {
        "price": Decimal("413"),
        "nested": {"pcts": [Decimal("12.0"), Decimal("-3.5")]},
        "untouched": ["RON", 3, None, True],
    }
    result = to_jsonable(payload)
    assert result == {
        "price": 413.0,
        "nested": {"pcts": [12.0, -3.5]},
        "untouched": ["RON", 3, None, True],
    }


@pytest.mark.parametrize("scalar", ["RON", 3, 1.5, True, False, None])
def test_json_scalars_pass_through_unchanged(scalar: object) -> None:
    assert to_jsonable(scalar) == scalar


def test_unknown_types_raise_type_error_at_the_boundary() -> None:
    class Opaque:
        pass

    with pytest.raises(TypeError, match="Opaque"):
        to_jsonable({"factors": [Opaque()]})


@pytest.mark.parametrize(
    "temporal",
    [date(2026, 7, 7), datetime(2026, 7, 7, 12, 0, tzinfo=UTC)],
)
def test_raw_dates_and_datetimes_are_rejected_with_guidance(temporal: object) -> None:
    # Callers convert temporals to ISO strings BEFORE the boundary (see
    # engine.explainer); a raw date/datetime reaching here is an upstream bug.
    with pytest.raises(TypeError, match="isoformat"):
        to_jsonable(temporal)


def test_real_factors_payload_serializes_without_decimals() -> None:
    ctx = make_ctx(competitor_rates=[Decimal("380.00"), Decimal("410.00"), Decimal("395.00")])
    payload = build_factors_payload(ctx, compute(ctx))
    jsonable = to_jsonable(payload)
    dumped = json.dumps(jsonable)  # would raise TypeError if a Decimal leaked
    parsed = json.loads(dumped)
    assert Decimal(str(parsed["base_price"])) == ctx.base_price
    assert Decimal(str(parsed["recommended_price"])) == payload["recommended_price"]
    assert [f["rule"] for f in parsed["factors"]] == [
        "seasonality",
        "event_impact",
        "competitor_position",
        "day_of_week",
        "lead_time",
    ]
