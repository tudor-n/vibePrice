"""Romanian public holidays.

Hardcoded 2026 list for now.

TODO: replace with the `holidays` PyPI package (``holidays.Romania``) so any
year works and legal changes are tracked upstream; persist into
``demand_signals`` (source="holidays").
"""

import logging
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from pricepilot.ingest.demand_signals import DemandSignalRecord, upsert_demand_signals

logger = logging.getLogger(__name__)

HOLIDAY_SIGNAL_TYPE = "public_holiday"
HOLIDAYS_SOURCE = "holidays"
_HOLIDAY_VALUE = Decimal("1")  # presence flag (numeric(14,4))

#: Days ahead we guarantee holiday coverage for (>= engine horizon of 90).
HOLIDAY_HORIZON_DAYS = 400

_HOLIDAYS_2026: list[date] = [
    date(2026, 1, 1),  # New Year's Day
    date(2026, 1, 2),  # Day after New Year
    date(2026, 1, 6),  # Epiphany
    date(2026, 1, 7),  # St. John the Baptist
    date(2026, 1, 24),  # Union of the Romanian Principalities
    date(2026, 4, 10),  # Orthodox Good Friday
    date(2026, 4, 12),  # Orthodox Easter Sunday
    date(2026, 4, 13),  # Orthodox Easter Monday
    date(2026, 5, 1),  # Labour Day
    date(2026, 5, 31),  # Orthodox Pentecost
    date(2026, 6, 1),  # Children's Day / Whit Monday
    date(2026, 8, 15),  # Dormition of the Theotokos
    date(2026, 11, 30),  # St. Andrew's Day
    date(2026, 12, 1),  # National Day
    date(2026, 12, 25),  # Christmas Day
    date(2026, 12, 26),  # Second day of Christmas
]


def romanian_public_holidays(year: int) -> list[date]:
    """Return Romanian public holidays for ``year`` (only 2026 supported so far)."""
    if year != 2026:
        raise NotImplementedError(
            f"Only 2026 is hardcoded; use the `holidays` package for year {year} (TODO)."
        )
    return list(_HOLIDAYS_2026)


def holiday_signal_records(city: str, year: int) -> list[DemandSignalRecord]:
    """Public holidays of ``year`` as city-scoped demand-signal flags.

    Raises ``NotImplementedError`` for a year the source cannot supply — callers
    that span multiple years should use :func:`supported_holiday_records`.
    """
    return [
        DemandSignalRecord(
            city=city,
            signal_type=HOLIDAY_SIGNAL_TYPE,
            signal_date=holiday,
            value=_HOLIDAY_VALUE,
        )
        for holiday in romanian_public_holidays(year)
    ]


def supported_holiday_records(city: str, years: list[int]) -> list[DemandSignalRecord]:
    """Holiday flags for every supported year in ``years`` (unsupported skipped)."""
    records: list[DemandSignalRecord] = []
    for year in years:
        try:
            records.extend(holiday_signal_records(city, year))
        except NotImplementedError:
            logger.warning("Skipping holidays for unsupported year %d (source TODO)", year)
    return records


def ingest_holidays(session: Session, *, city: str, today: date | None = None) -> int:
    """Upsert public-holiday flags for ``city`` across the coverage horizon.

    Covers every calendar year touched by ``[today, today + HOLIDAY_HORIZON_DAYS]``
    so a 90-day recommendation window that crosses Dec 31 still has coverage.
    Unsupported years are skipped (logged). Idempotent; does not commit.
    """
    today = today or date.today()
    end = today + timedelta(days=HOLIDAY_HORIZON_DAYS)
    years = list(range(today.year, end.year + 1))
    records = supported_holiday_records(city, years)
    return upsert_demand_signals(session, records, source=HOLIDAYS_SOURCE)
