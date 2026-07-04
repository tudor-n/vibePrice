"""Romanian public holidays.

Hardcoded 2026 list for now.

TODO: replace with the `holidays` PyPI package (``holidays.Romania``) so any
year works and legal changes are tracked upstream; persist into
``demand_signals`` (source="holidays").
"""

from datetime import date

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
