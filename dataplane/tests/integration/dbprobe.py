"""Shared integration-test DB probe.

Local convention: integration tests SKIP when the dev database is unreachable
or unmigrated. In CI the dedicated job sets ``PRICEPILOT_REQUIRE_DB=1``, which
turns "unavailable" into a hard collection error — the schema-sync check must
never pass by being skipped.
"""

import os

import pytest
from sqlalchemy import create_engine, text

DEFAULT_DATABASE_URL = "postgresql+psycopg://pricepilot:devpassword@localhost:5432/pricepilot"
DATABASE_URL = os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)


def db_ready() -> tuple[bool, str]:
    """(True, "") when the dev DB is reachable and migrated, else (False, why)."""
    try:
        probe = create_engine(DATABASE_URL, connect_args={"connect_timeout": 2})
        try:
            with probe.connect() as conn:
                has_schema = conn.execute(text("SELECT to_regclass('recommendations')")).scalar()
            if has_schema is None:
                return False, "schema missing — apply the backend EF migrations"
            return True, ""
        finally:
            probe.dispose()
    except Exception as exc:  # noqa: BLE001 - any connection failure means skip
        return False, str(exc)


def integration_marks() -> list:
    """Module-level ``pytestmark`` for integration test files."""
    ready, reason = db_ready()
    if not ready and os.environ.get("PRICEPILOT_REQUIRE_DB") == "1":
        raise RuntimeError(f"PRICEPILOT_REQUIRE_DB=1 but the database is unavailable: {reason}")
    return [
        pytest.mark.integration,
        pytest.mark.skipif(not ready, reason=f"integration database unavailable: {reason}"),
    ]
