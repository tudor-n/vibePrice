"""Local events calendar ingestion.

v1 ships a static, seeded source for Sibiu so the engine has real events to
reason about from day one.

TODO: replace :class:`StaticSibiuEventSource` with real calendar scraping
(sibiu.ro / turism.sibiu.ro event calendars) writing to the ``events`` table.
"""

from dataclasses import dataclass
from datetime import date
from uuid import UUID


@dataclass(frozen=True)
class EventRecord:
    """A city-scoped demand event with a 0-100 impact score."""

    city: str
    name: str
    start_date: date
    end_date: date
    impact_score: int  # 0-100
    id: UUID | None = None  # set once persisted to the `events` table


class StaticSibiuEventSource:
    """Seeded 2026 Sibiu events. TODO: replace with real calendar scraping."""

    city = "sibiu"

    def fetch(self) -> list[EventRecord]:
        return [
            EventRecord(
                city="sibiu",
                name="FITS (Sibiu International Theatre Festival)",
                start_date=date(2026, 6, 12),
                end_date=date(2026, 6, 21),
                impact_score=90,
            ),
            EventRecord(
                city="sibiu",
                name="Sibiu Christmas Market",
                start_date=date(2026, 11, 20),
                end_date=date(2027, 1, 4),
                impact_score=75,
            ),
            EventRecord(
                city="sibiu",
                name="Astra Film Festival",
                start_date=date(2026, 10, 12),
                end_date=date(2026, 10, 18),
                impact_score=60,
            ),
        ]
