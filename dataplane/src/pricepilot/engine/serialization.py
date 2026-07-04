"""Decimal-safe conversion of the factors payload for JSONB persistence.

Repo rule: money is ``Decimal``, never float — **in computation**. JSON has no
decimal type, and the factors contract (`recommendation-factors.md`) specifies
JSON *numbers*, not strings. The boundary decision (documented here, tested in
``tests/test_serialization.py``):

* floats appear ONLY in the serialized JSON payload, never in computation;
* every ``Decimal`` is quantized to 2dp first, then converted with ``float()``.

This is lossless for our domain: ``numeric(10,2)`` money tops out at
``99999999.99`` (10 significant digits) and engine percentages carry <= 2dp,
and any decimal with <= 15 significant digits survives the
``Decimal -> float -> repr -> Decimal`` round-trip exactly (IEEE-754 doubles
uniquely represent all 15-significant-digit decimals, and ``repr``/``json``
emit the shortest round-tripping form).
"""

from decimal import Decimal
from typing import Any

_TWO_DP = Decimal("0.01")


def to_jsonable(value: Any) -> Any:
    """Recursively convert a payload for JSON: Decimals become 2dp floats.

    Use only at the persistence boundary (JSONB columns); never feed the
    result back into price arithmetic.
    """
    if isinstance(value, Decimal):
        return float(value.quantize(_TWO_DP))
    if isinstance(value, dict):
        return {key: to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]
    return value
