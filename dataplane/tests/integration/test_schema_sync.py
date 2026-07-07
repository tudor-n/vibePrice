"""Schema-sync guard: tables.py must agree with the EF-migrated database.

This is the CI drift check (spec: docs/superpowers/specs/
2026-07-07-schema-sync-check-design.md). Drift bit twice before it existed
(wave 2, wave 2.1) — if this fails, fix ``tables.py``; the database is ground
truth and the dataplane never emits DDL.
"""

from dbprobe import DATABASE_URL, integration_marks
from sqlalchemy import MetaData, create_engine

from pricepilot.db.schema_check import diff_schema
from pricepilot.db.tables import Base

pytestmark = integration_marks()


def test_mappings_match_migrated_schema() -> None:
    engine = create_engine(DATABASE_URL)
    try:
        reflected = MetaData()
        reflected.reflect(bind=engine)
    finally:
        engine.dispose()

    problems = diff_schema(Base.metadata, reflected)
    assert problems == [], "schema drift (fix tables.py):\n" + "\n".join(problems)
