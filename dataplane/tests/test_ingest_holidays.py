"""Romanian public holidays via the `holidays` package (pure, no network)."""

from datetime import date
from decimal import Decimal

from pricepilot.ingest.holidays import holiday_signal_records, romanian_public_holidays

# The legally fixed 2026 calendar (previously hardcoded here) — pins the
# package against regressions and against accidental locale/subdiv changes.
EXPECTED_2026 = {
    date(2026, 1, 1),
    date(2026, 1, 2),
    date(2026, 1, 6),
    date(2026, 1, 7),
    date(2026, 1, 24),
    date(2026, 4, 10),  # Orthodox Good Friday
    date(2026, 4, 12),  # Orthodox Easter Sunday
    date(2026, 4, 13),  # Orthodox Easter Monday
    date(2026, 5, 1),
    date(2026, 5, 31),  # Orthodox Pentecost
    date(2026, 6, 1),   # Children's Day / Whit Monday
    date(2026, 8, 15),
    date(2026, 11, 30),
    date(2026, 12, 1),
    date(2026, 12, 25),
    date(2026, 12, 26),
}


def test_2026_matches_the_legal_calendar() -> None:
    assert set(romanian_public_holidays(2026)) >= EXPECTED_2026


def test_any_year_works_not_just_2026() -> None:
    holidays_2027 = romanian_public_holidays(2027)
    assert date(2027, 12, 1) in holidays_2027  # National Day is fixed
    assert date(2027, 5, 2) in holidays_2027  # Orthodox Easter 2027 (movable feast)


def test_signal_records_window_is_inclusive() -> None:
    records = holiday_signal_records(
        "sibiu", start=date(2026, 12, 1), end=date(2026, 12, 26)
    )
    dates = [r.signal_date for r in records]
    assert date(2026, 12, 1) in dates  # start boundary
    assert date(2026, 12, 26) in dates  # end boundary
    assert date(2026, 11, 30) not in dates
    for record in records:
        assert record.city == "sibiu"
        assert record.signal_type == "public_holiday"
        assert record.value == Decimal("1")


def test_window_spanning_a_year_boundary() -> None:
    records = holiday_signal_records(
        "sibiu", start=date(2026, 12, 20), end=date(2027, 1, 10)
    )
    dates = {r.signal_date for r in records}
    assert date(2026, 12, 25) in dates
    assert date(2027, 1, 1) in dates
