"""Shared test helpers."""

from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from pricepilot.engine.models import RuleContext

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def make_ctx(**overrides: Any) -> RuleContext:
    """A RuleContext with sane Sibiu defaults; override any field per test.

    Defaults to a Tuesday (2026-06-16) in a normal booking window with no
    events and no competitor data, so every default rule contributes 0 except
    seasonality — tests override exactly what they exercise.
    """
    defaults: dict[str, Any] = {
        "city": "sibiu",
        "stay_date": date(2026, 6, 16),  # a Tuesday
        "base_price": Decimal("350.00"),
        "currency": "RON",
        "current_price": Decimal("350.00"),
        "lead_days": 30,
        "events": [],
        "competitor_rates": [],
        "avg_occupancy_by_month": None,
        "scraped_rates_at": None,
        "events_at": None,
    }
    defaults.update(overrides)
    return RuleContext(**defaults)


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES_DIR
