"""Ordered rule registry.

Every rule is a pure function ``(RuleContext) -> FactorResult``. The order here
is the order factors appear in the ``factors`` payload (matches
``shared/contracts/recommendation-factors.md``). Adding a rule: create the
module, give it a reason string for every branch, register it here, add
boundary tests, and update the contract if the payload shape changes.
"""

from collections.abc import Callable

from pricepilot.engine.models import FactorResult, RuleContext
from pricepilot.engine.rules import (
    competitor_position,
    day_of_week,
    event_impact,
    lead_time,
    seasonality,
)

Rule = Callable[[RuleContext], FactorResult]

RULES: list[Rule] = [
    seasonality.apply,
    event_impact.apply,
    competitor_position.apply,
    day_of_week.apply,
    lead_time.apply,
]
