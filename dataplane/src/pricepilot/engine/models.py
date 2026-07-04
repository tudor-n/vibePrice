"""Engine data types. Rules are pure: RuleContext in, FactorResult out, no I/O."""

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from pricepilot.ingest.events import EventRecord


@dataclass(frozen=True)
class RuleContext:
    """Everything a rule may look at for one (room type, stay date) decision.

    All money is ``Decimal`` and travels with ``currency``. The trailing
    ``*_at`` fields are engine metadata used for the ``data_freshness`` block
    of the factors payload.
    """

    city: str
    stay_date: date
    base_price: Decimal
    currency: str
    current_price: Decimal
    lead_days: int
    events: list[EventRecord] = field(default_factory=list)
    competitor_rates: list[Decimal] = field(default_factory=list)
    avg_occupancy_by_month: dict[int, float] | None = None
    scraped_rates_at: datetime | None = None
    events_at: datetime | None = None


@dataclass(frozen=True)
class FactorResult:
    """One rule's contribution: a signed percentage adjustment with a reason.

    ``extra`` carries rule-specific payload keys merged into the factor JSON
    (e.g. ``event_ids`` for event_impact, ``sample_size`` for
    competitor_position) — see ``shared/contracts/recommendation-factors.md``.
    """

    rule: str
    adjustment_pct: Decimal
    reason: str
    extra: dict[str, object] = field(default_factory=dict)
