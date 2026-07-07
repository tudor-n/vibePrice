"""Schema drift detection: declared SQLAlchemy metadata vs the live database.

The backend's EF migrations own the schema (``shared/contracts/table-ownership.md``);
``tables.py`` mirrors it. This module answers "do they still agree?" as a pure
function so the rules are unit-testable without a database; the integration test
``tests/integration/test_schema_sync.py`` feeds it the reflected dev/CI schema.

Rules (spec: ``docs/superpowers/specs/2026-07-07-schema-sync-check-design.md``):

* every declared table must exist;
* every mapped column must exist with matching type (compiled for the
  PostgreSQL dialect, so lengths/precision count) and nullability;
* on dataplane-WRITTEN tables the mapping must also be complete — an unmapped
  NOT NULL column breaks INSERTs. Backend-only tables may be partially mapped.

Out of scope by design: indexes, FKs, server defaults, undeclared tables.
"""

from sqlalchemy import MetaData
from sqlalchemy.dialects import postgresql
from sqlalchemy.types import TypeEngine

#: Tables the dataplane writes (shared/contracts/table-ownership.md). Their
#: mappings must cover every database column.
DATAPLANE_WRITTEN_TABLES = frozenset(
    {
        "scraped_rates",
        "scrape_runs",
        "events",
        "demand_signals",
        "recommendations",
        "own_bookings",
        "jobs",
    }
)

_DIALECT = postgresql.dialect()


def _type_str(col_type: TypeEngine) -> str:
    # No alias table / whitespace normalization on purpose: both sides compile
    # through the same dialect, so identical types always yield identical
    # strings — a spelling mismatch can only fail loudly, never pass silently.
    return col_type.compile(dialect=_DIALECT).upper().strip()


def diff_schema(declared: MetaData, reflected: MetaData) -> list[str]:
    """Every disagreement between the mapping and the database, one line each."""
    problems: list[str] = []
    for name, table in sorted(declared.tables.items()):
        db_table = reflected.tables.get(name)
        if db_table is None:
            problems.append(f"{name}: table missing from database")
            continue
        db_cols = {c.name: c for c in db_table.columns}
        for col in table.columns:
            db_col = db_cols.get(col.name)
            if db_col is None:
                problems.append(f"{name}.{col.name}: mapped but missing from database")
                continue
            declared_type, db_type = _type_str(col.type), _type_str(db_col.type)
            if declared_type != db_type:
                problems.append(
                    f"{name}.{col.name}: mapped type {declared_type} != database {db_type}"
                )
            if bool(col.nullable) != bool(db_col.nullable):
                problems.append(
                    f"{name}.{col.name}: mapped nullable={col.nullable} "
                    f"!= database nullable={db_col.nullable}"
                )
        if name in DATAPLANE_WRITTEN_TABLES:
            unmapped = sorted(set(db_cols) - {c.name for c in table.columns})
            problems.extend(
                f"{name}.{extra}: in database but not mapped "
                "(dataplane-written tables must be fully mapped)"
                for extra in unmapped
            )
    return problems
