"""Romanian public holidays as demand signals (pure computation, no network).

Backed by the `holidays` PyPI package (legal-calendar changes tracked
upstream), replacing the original hardcoded 2026 list. Holidays become
``demand_signals`` rows (``signal_type="public_holiday"``, value 1) so engine
rules can price bridge weekends and holiday peaks once a consuming rule lands.
"""

from datetime import date, timedelta
from decimal import Decimal

import holidays as holidays_lib

from pricepilot.ingest.signals import SignalRecord

SIGNAL_TYPE = "public_holiday"


def romanian_public_holidays(year: int) -> list[date]:
    """All Romanian public holidays for ``year``, sorted."""
    return sorted(holidays_lib.Romania(years=year).keys())


def holiday_signal_records(city: str, start: date, end: date) -> list[SignalRecord]:
    """Holiday signals for every holiday in [start, end], both inclusive."""
    calendar = holidays_lib.Romania(years=range(start.year, end.year + 1))
    records: list[SignalRecord] = []
    day = start
    while day <= end:
        if day in calendar:
            records.append(
                SignalRecord(
                    city=city,
                    signal_type=SIGNAL_TYPE,
                    signal_date=day,
                    value=Decimal("1"),
                )
            )
        day += timedelta(days=1)
    return records
