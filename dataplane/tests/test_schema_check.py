"""Unit tests for the schema drift diff — no database, hand-built MetaData."""

from sqlalchemy import CHAR, Column, Date, Integer, MetaData, Numeric, String, Table

from pricepilot.db.schema_check import DATAPLANE_WRITTEN_TABLES, diff_schema


def problems_contain(problems: list[str], *needles: str) -> bool:
    return any(all(needle in p for needle in needles) for p in problems)


def _declared(*cols: Column) -> MetaData:
    md = MetaData()
    Table("events", md, *cols)
    return md


def _reflected(*cols: Column) -> MetaData:
    md = MetaData()
    Table("events", md, *cols)
    return md


def test_in_sync_schema_has_no_drift() -> None:
    declared = _declared(Column("name", String(300), nullable=False))
    reflected = _reflected(Column("name", String(300), nullable=False))
    assert diff_schema(declared, reflected) == []


def test_missing_table_is_drift() -> None:
    declared = _declared(Column("name", String(300), nullable=False))
    problems = diff_schema(declared, MetaData())
    assert problems == ["events: table missing from database"]


def test_mapped_column_missing_from_database_is_drift() -> None:
    declared = _declared(
        Column("name", String(300), nullable=False),
        Column("phantom", Integer, nullable=False),
    )
    reflected = _reflected(Column("name", String(300), nullable=False))
    assert problems_contain(
        diff_schema(declared, reflected), "events.phantom", "missing from database"
    )


def test_type_mismatch_is_drift_including_length() -> None:
    declared = _declared(Column("name", String(200), nullable=False))
    reflected = _reflected(Column("name", String(300), nullable=False))
    assert problems_contain(
        diff_schema(declared, reflected), "events.name", "VARCHAR(200)", "VARCHAR(300)"
    )


def test_char_vs_varchar_is_drift() -> None:
    declared = _declared(Column("currency", String(3), nullable=False))
    reflected = _reflected(Column("currency", CHAR(3), nullable=False))
    assert problems_contain(diff_schema(declared, reflected), "events.currency", "CHAR(3)")


def test_numeric_precision_scale_compared() -> None:
    declared = _declared(Column("price", Numeric(10, 2), nullable=False))
    reflected = _reflected(Column("price", Numeric(14, 4), nullable=False))
    assert problems_contain(
        diff_schema(declared, reflected), "events.price", "NUMERIC(10, 2)", "NUMERIC(14, 4)"
    )


def test_nullability_mismatch_is_drift() -> None:
    declared = _declared(Column("start_date", Date, nullable=True))
    reflected = _reflected(Column("start_date", Date, nullable=False))
    assert problems_contain(
        diff_schema(declared, reflected), "events.start_date", "nullable"
    )


def test_unmapped_db_column_is_drift_only_for_dataplane_written_tables() -> None:
    assert "events" in DATAPLANE_WRITTEN_TABLES  # premise of this test
    declared = _declared(Column("name", String(300), nullable=False))
    reflected = _reflected(
        Column("name", String(300), nullable=False),
        Column("source", String(100), nullable=False),
    )
    assert problems_contain(diff_schema(declared, reflected), "events.source", "not mapped")

    # Same shape on a backend-only table: partial mapping is deliberate, no drift.
    declared_md, reflected_md = MetaData(), MetaData()
    Table("tenants", declared_md, Column("name", String(200), nullable=False))
    Table(
        "tenants",
        reflected_md,
        Column("name", String(200), nullable=False),
        Column("subscription_plan", String(50), nullable=False),
    )
    assert diff_schema(declared_md, reflected_md) == []
