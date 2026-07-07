# Schema-Sync Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CI-enforced check that fails when `dataplane/src/pricepilot/db/tables.py` drifts from the schema the backend EF migrations produce, plus two ride-alongs: a partial unique index on pending recommendations and a stale-volume-proof demo-seed test.

**Architecture:** A pure diff function (`schema_check.py`) compares `Base.metadata` against a SQLAlchemy-reflected live schema; an integration test runs it against the migrated dev DB; a new CI job provisions Postgres, applies EF migrations with backend tooling, and runs the full dataplane suite with skips forbidden.

**Tech Stack:** SQLAlchemy 2.x reflection/compile, pytest, GitHub Actions services, EF Core migrations.

Spec: `docs/superpowers/specs/2026-07-07-schema-sync-check-design.md`.

## Global Constraints

- `tables.py` never emits DDL; the database is ground truth — drift is fixed in `tables.py`, never with Python-side DDL.
- Money stays `Decimal`/`numeric`; stay dates `date`; instants UTC `timestamptz`.
- Backend builds with `-warnaserror`; dataplane must pass `ruff check src tests`.
- Dev DB: `postgresql+psycopg://pricepilot:devpassword@localhost:5432/pricepilot` (docker compose `db`).
- Commands on this machine (Windows): dataplane `. .venv\Scripts\python -m pytest`; backend `dotnet build && dotnet test`.
- Conventional commits; commit after each task.

---

### Task 1: Pure diff function `schema_check.py` (TDD, no DB)

**Files:**
- Create: `dataplane/src/pricepilot/db/schema_check.py`
- Test: `dataplane/tests/test_schema_check.py`

**Interfaces:**
- Produces: `diff_schema(declared: MetaData, reflected: MetaData) -> list[str]` and `DATAPLANE_WRITTEN_TABLES: frozenset[str]`, consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

```python
"""Unit tests for the schema drift diff — no database, hand-built MetaData."""

from sqlalchemy import CHAR, Column, Date, Integer, MetaData, Numeric, String, Table

from pricepilot.db.schema_check import DATAPLANE_WRITTEN_TABLES, diff_schema


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
    assert problems_contain(diff_schema(declared, reflected), "events.phantom", "missing from database")


def test_type_mismatch_is_drift_including_length() -> None:
    declared = _declared(Column("name", String(200), nullable=False))
    reflected = _reflected(Column("name", String(300), nullable=False))
    assert problems_contain(diff_schema(declared, reflected), "events.name", "VARCHAR(200)", "VARCHAR(300)")


def test_char_vs_varchar_is_drift() -> None:
    declared = _declared(Column("currency", String(3), nullable=False))
    reflected = _reflected(Column("currency", CHAR(3), nullable=False))
    assert problems_contain(diff_schema(declared, reflected), "events.currency", "CHAR(3)")


def test_numeric_precision_scale_compared() -> None:
    declared = _declared(Column("price", Numeric(10, 2), nullable=False))
    reflected = _reflected(Column("price", Numeric(14, 4), nullable=False))
    assert problems_contain(diff_schema(declared, reflected), "events.price", "NUMERIC(10, 2)", "NUMERIC(14, 4)")


def test_nullability_mismatch_is_drift() -> None:
    declared = _declared(Column("start_date", Date, nullable=True))
    reflected = _reflected(Column("start_date", Date, nullable=False))
    assert problems_contain(diff_schema(declared, reflected), "events.start_date", "nullable")


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


def problems_contain(problems: list[str], *needles: str) -> bool:
    return any(all(needle in p for needle in needles) for p in problems)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd D:\hotel-price\dataplane; .venv\Scripts\python -m pytest tests/test_schema_check.py -q`
Expected: collection error — `ModuleNotFoundError: No module named 'pricepilot.db.schema_check'`

- [ ] **Step 3: Implement `schema_check.py`**

```python
"""Schema drift detection: declared SQLAlchemy metadata vs the live database.

The backend's EF migrations own the schema (``shared/contracts/table-ownership.md``);
``tables.py`` mirrors it. This module answers "do they still agree?" as a pure
function so the rules are unit-testable without a database; the integration test
``tests/integration/test_schema_sync.py`` feeds it the reflected dev/CI schema.

Rules (spec: docs/superpowers/specs/2026-07-07-schema-sync-check-design.md):

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
```

- [ ] **Step 4: Run tests, expect all pass**

Run: `cd D:\hotel-price\dataplane; .venv\Scripts\python -m pytest tests/test_schema_check.py -q`
Expected: `8 passed`

- [ ] **Step 5: Lint and commit**

Run: `cd D:\hotel-price\dataplane; .venv\Scripts\python -m ruff check src tests`
Expected: `All checks passed!`

```bash
git add dataplane/src/pricepilot/db/schema_check.py dataplane/tests/test_schema_check.py
git commit -m "feat(dataplane): pure schema-drift diff between mappings and reflected schema"
```

---

### Task 2: Shared DB probe with require-mode (`dbprobe.py`)

**Files:**
- Create: `dataplane/tests/integration/dbprobe.py`
- Modify: `dataplane/tests/integration/test_engine_e2e.py:34-72` (replace inline probe)

**Interfaces:**
- Produces: `DATABASE_URL: str`, `db_ready() -> tuple[bool, str]`, `integration_marks() -> list` — consumed by Task 3's test and by `test_engine_e2e.py`. `integration_marks()` raises `RuntimeError` when `PRICEPILOT_REQUIRE_DB=1` and the DB is unavailable (collection error in CI instead of a silent skip).

- [ ] **Step 1: Create `dbprobe.py`**

```python
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
```

- [ ] **Step 2: Use it from `test_engine_e2e.py`**

Replace lines 34-35 (`DEFAULT_DATABASE_URL` / `DATABASE_URL` constants), delete `_db_ready()` (lines 52-64) and the `_READY, _SKIP_REASON` / `pytestmark` block (lines 67-72), with:

```python
from dbprobe import DATABASE_URL, integration_marks

pytestmark = integration_marks()
```

(`dbprobe` imports as a top-level module because pytest prepends each test file's directory to `sys.path` — same mechanism that makes `conftest.py` work without `__init__.py`.) Keep the module docstring's setup instructions; drop the now-unused `text` import only if nothing else uses it (the demo-rows fixture does use `text` — check before removing).

- [ ] **Step 3: Verify both modes**

Run: `cd D:\hotel-price\dataplane; .venv\Scripts\python -m pytest tests/integration -q` (DB up)
Expected: same pass/fail count as before the refactor (no behavior change with DB available).

Run (require-mode failure path, DB name that doesn't exist):
`$env:PRICEPILOT_REQUIRE_DB="1"; $env:DATABASE_URL="postgresql+psycopg://pricepilot:devpassword@localhost:5432/nope"; .venv\Scripts\python -m pytest tests/integration -q; Remove-Item env:PRICEPILOT_REQUIRE_DB; Remove-Item env:DATABASE_URL`
Expected: collection ERROR mentioning `PRICEPILOT_REQUIRE_DB=1 but the database is unavailable` (exit code non-zero, not a skip).

- [ ] **Step 4: Lint and commit**

```bash
git add dataplane/tests/integration/dbprobe.py dataplane/tests/integration/test_engine_e2e.py
git commit -m "refactor(dataplane): shared DB probe with PRICEPILOT_REQUIRE_DB hard-fail mode"
```

---

### Task 3: Integration test `test_schema_sync.py` + fix surfaced drift

**Files:**
- Create: `dataplane/tests/integration/test_schema_sync.py`
- Modify: `dataplane/src/pricepilot/db/tables.py` (whatever drift the check reports; known: 4× `currency` `String(3)` → `CHAR(3)`)

**Interfaces:**
- Consumes: `diff_schema`, `DATAPLANE_WRITTEN_TABLES` (Task 1); `DATABASE_URL`, `integration_marks` (Task 2).

- [ ] **Step 1: Write the test**

```python
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
```

- [ ] **Step 2: Run — expect it to FAIL with real drift**

Run: `cd D:\hotel-price\dataplane; .venv\Scripts\python -m pytest tests/integration/test_schema_sync.py -q`
Expected: FAIL listing at least the four currency columns (`scraped_rates.currency`, `room_types.currency`, `recommendations.currency`, `own_bookings.currency`): `mapped type VARCHAR(3) != database CHAR(3)`. There may be more lines — that is the check doing its job.

- [ ] **Step 3: Fix every reported line in `tables.py`**

Known fix — import `CHAR` from `sqlalchemy` and change all four:

```python
    currency: Mapped[str] = mapped_column(CHAR(3))
```

For any other reported drift: change the mapping to match the database (never the other way). If a line looks like the *database* is wrong (a migration bug), stop and record it in `docs/roadmap.md` instead of silently adapting — but expect mappings to be at fault.

- [ ] **Step 4: Re-run until green, then full suite**

Run: `cd D:\hotel-price\dataplane; .venv\Scripts\python -m pytest -q` (DB up)
Expected: schema-sync test passes; full suite otherwise unchanged.

- [ ] **Step 5: Lint and commit**

```bash
git add dataplane/tests/integration/test_schema_sync.py dataplane/src/pricepilot/db/tables.py
git commit -m "feat(dataplane): schema-sync integration check; align currency mappings to char(3)"
```

---

### Task 4: Window-scope `test_demo_seed_is_idempotent`

**Files:**
- Modify: `dataplane/tests/integration/test_engine_e2e.py` (the `test_demo_seed_is_idempotent` function, currently asserting a global per-competitor count)

**Interfaces:** none new.

- [ ] **Step 1: Pin the seed window in the test**

Change the test to fix `today` once and count only in-window rows, so past-dated leftovers in a dev volume can't inflate it:

```python
def test_demo_seed_is_idempotent(session: Session) -> None:
    today = date.today()
    first = seed(session, today=today)
    session.commit()
    second = seed(session, today=today)
    session.commit()
    assert first["scraped_rates_written"] == second["scraped_rates_written"] == 3 * SEED_DAYS

    competitor_ids = [p.competitor_id for p in COMPETITOR_PROFILES]
    rate_count = session.execute(
        select(func.count()).where(
            ScrapedRate.competitor_id.in_(competitor_ids),
            ScrapedRate.stay_date >= today,  # stale dev volumes hold past-dated rows
        )
    ).scalar()
    assert rate_count == 3 * SEED_DAYS  # upsert on deterministic ids: no duplicates
```

- [ ] **Step 2: Prove it fixes the stale-volume failure**

Run: `cd D:\hotel-price\dataplane; .venv\Scripts\python -m pytest tests/integration/test_engine_e2e.py::test_demo_seed_is_idempotent -q`
Expected: PASS against the current dev volume (which held 9 stale past-dated rows and failed before this change).

- [ ] **Step 3: Full dataplane suite green**

Run: `cd D:\hotel-price\dataplane; .venv\Scripts\python -m pytest -q`
Expected: **0 failures** (first fully green DB-backed run; wave 2.1 had 1 environmental failure exactly here).

- [ ] **Step 4: Commit**

```bash
git add dataplane/tests/integration/test_engine_e2e.py
git commit -m "fix(dataplane): scope demo-seed idempotency count to the current seed window"
```

---

### Task 5: CI job `dataplane-integration`

**Files:**
- Modify: `.github/workflows/ci.yml` (append job)

**Interfaces:**
- Consumes: `PRICEPILOT_REQUIRE_DB` semantics from Task 2.

- [ ] **Step 1: Append the job**

```yaml
  # Postgres-backed run: applies backend EF migrations (schema owner), then runs
  # the whole dataplane suite — schema-sync drift check included — with skips
  # forbidden (PRICEPILOT_REQUIRE_DB=1). The plain `dataplane` job stays as the
  # fast DB-less run.
  dataplane-integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_DB: pricepilot
          POSTGRES_USER: pricepilot
          POSTGRES_PASSWORD: devpassword
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U pricepilot -d pricepilot"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: "9.0.x"
      - name: Apply EF migrations (backend owns the schema)
        working-directory: backend
        run: |
          dotnet tool restore
          dotnet tool run dotnet-ef database update \
            --project src/PricePilot.Infrastructure --startup-project src/PricePilot.Api \
            --connection "Host=localhost;Port=5432;Database=pricepilot;Username=pricepilot;Password=devpassword"
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Run dataplane suite against the migrated database
        working-directory: dataplane
        env:
          DATABASE_URL: postgresql+psycopg://pricepilot:devpassword@localhost:5432/pricepilot
          PRICEPILOT_REQUIRE_DB: "1"
        run: |
          pip install -e .[dev]
          python -m pytest
```

- [ ] **Step 2: Validate YAML + simulate locally**

Run: `cd D:\hotel-price; docker run --rm -v "${PWD}:/repo" rhysd/actionlint:latest -color /repo/.github/workflows/ci.yml` — or, if that image is unavailable, `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` from the dataplane venv as a syntax floor.
Expected: no errors.

Local simulation of the job's semantics (dev DB already migrated): `cd D:\hotel-price\dataplane; $env:PRICEPILOT_REQUIRE_DB="1"; .venv\Scripts\python -m pytest -q; Remove-Item env:PRICEPILOT_REQUIRE_DB`
Expected: full pass, nothing skipped in `tests/integration`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: dataplane-integration job — EF-migrated Postgres + full suite, skips forbidden"
```

---

### Task 6: Backend partial unique index on pending recommendations

**Files:**
- Modify: `backend/src/PricePilot.Infrastructure/AppDbContext.cs` (Recommendation entity block)
- Create: migration `backend/src/PricePilot.Infrastructure/Migrations/<timestamp>_AddPendingRecommendationUniqueIndex.cs` (generated)
- Test: `backend/tests/PricePilot.UnitTests/RecommendationIndexTests.cs`
- Modify: `shared/contracts/table-ownership.md` (recommendations row), `dataplane/src/pricepilot/db/tables.py` (comment on `Recommendation`)

**Interfaces:** none consumed by other tasks.

- [ ] **Step 1: Write the failing metadata test**

```csharp
using Microsoft.EntityFrameworkCore;
using PricePilot.Domain;
using PricePilot.Infrastructure;

namespace PricePilot.UnitTests;

/// <summary>
/// The engine replaces pending recommendations per (room_type_id, stay_date) in one
/// transaction; this partial unique index makes a concurrent-worker race fail loudly
/// instead of writing duplicate pending rows. Decided rows are exempt.
/// </summary>
public class RecommendationIndexTests
{
    [Fact]
    public void Pending_recommendations_have_a_partial_unique_index()
    {
        using var db = TestDb.CreateContext(); // reuse the existing SQLite in-memory helper used by tenant-filter tests; if the helper has a different name, use that one — do NOT invent a second harness
        var entity = db.Model.FindEntityType(typeof(Recommendation))!;
        var index = entity.GetIndexes().Single(i =>
            i.Properties.Select(p => p.Name).SequenceEqual(new[] { "RoomTypeId", "StayDate" }));

        Assert.True(index.IsUnique);
        Assert.Equal("status = 'pending'", index.GetFilter());
    }
}
```

(First read an existing unit test that constructs `AppDbContext` — e.g. the tenant-filter tests — and reuse its context factory verbatim; the `TestDb.CreateContext()` name above is a stand-in for whatever that helper is actually called.)

- [ ] **Step 2: Run to verify failure**

Run: `cd D:\hotel-price\backend; dotnet test --filter RecommendationIndexTests`
Expected: FAIL — no index on (RoomTypeId, StayDate).

- [ ] **Step 3: Add the index mapping**

In the `modelBuilder.Entity<Recommendation>` block of `AppDbContext.cs`:

```csharp
// At most one PENDING recommendation per room type and stay date. The dataplane
// replaces pending rows per (room_type_id, stay_date) in one transaction; with
// concurrent workers this turns a race into a loud unique violation instead of
// duplicate pending rows. Decided rows are exempt (history may repeat a date).
e.HasIndex(x => new { x.RoomTypeId, x.StayDate })
    .IsUnique()
    .HasFilter("status = 'pending'");
```

- [ ] **Step 4: Generate the migration**

```bash
cd backend
dotnet tool restore
dotnet tool run dotnet-ef migrations add AddPendingRecommendationUniqueIndex --project src/PricePilot.Infrastructure --startup-project src/PricePilot.Api
```

Inspect the generated migration: exactly one `CreateIndex` on `recommendations (room_type_id, stay_date)` with `unique: true, filter: "status = 'pending'"` — nothing else. (If unrelated diffs appear, the snapshot was dirty: stop and investigate.)

- [ ] **Step 5: Build, test, apply to dev DB**

Run: `cd D:\hotel-price\backend; dotnet build; dotnet test`
Expected: build 0 warnings; all tests pass including the new one.

Run: `cd D:\hotel-price\backend; dotnet tool run dotnet-ef database update --project src/PricePilot.Infrastructure --startup-project src/PricePilot.Api --connection "Host=localhost;Port=5432;Database=pricepilot;Username=pricepilot;Password=devpassword"`
Expected: `Applying migration '..._AddPendingRecommendationUniqueIndex'. Done.` (Current data satisfies it: the wave-2.1 purge keeps one pending row per key.)

- [ ] **Step 6: Contract + mapping notes**

`shared/contracts/table-ownership.md`, `recommendations` row — replace the Notes cell with:

```
dataplane INSERTs new rows; backend UPDATEs `status` only (pending → accepted/dismissed). Partial unique index: at most one **pending** row per (room_type_id, stay_date) — concurrent engine runs fail loudly instead of duplicating
```

`dataplane/src/pricepilot/db/tables.py`, on the `Recommendation` class docstring, append:

```
    DB enforces at most one PENDING row per (room_type_id, stay_date)
    (partial unique index) — the engine's delete-then-insert transaction
    relies on it failing loudly under concurrent workers.
```

- [ ] **Step 7: Dataplane suite still green (index must not break the engine)**

Run: `cd D:\hotel-price\dataplane; .venv\Scripts\python -m pytest -q`
Expected: all pass (engine e2e re-runs the generate job against the indexed table).

- [ ] **Step 8: Commit**

```bash
git add backend/src/PricePilot.Infrastructure/AppDbContext.cs backend/src/PricePilot.Infrastructure/Migrations backend/tests/PricePilot.UnitTests/RecommendationIndexTests.cs shared/contracts/table-ownership.md dataplane/src/pricepilot/db/tables.py
git commit -m "feat(api): partial unique index on pending recommendations (room_type_id, stay_date)"
```

---

### Task 7: Docs, review, roadmap

**Files:**
- Modify: `dataplane/CLAUDE.md` (module map row for `schema_check.py`; integration-tests section: `PRICEPILOT_REQUIRE_DB`, CI job)
- Modify: `docs/roadmap.md` (move the three backlog items to Done with dates; note first fully-green CI-integration run)

**Interfaces:** none.

- [ ] **Step 1: `dataplane/CLAUDE.md`** — add to the module map table:

```
| `src/pricepilot/db/schema_check.py` | drift diff: mappings vs reflected DB schema (CI-enforced) |
```

and to the integration-tests section:

```
CI runs the full suite against an EF-migrated Postgres in the `dataplane-integration`
job with `PRICEPILOT_REQUIRE_DB=1` (unavailable DB = hard failure, never a skip).
The schema-sync check (`tests/integration/test_schema_sync.py`) fails on any drift
between `db/tables.py` and the migrated schema — fix the mapping, never emit DDL.
```

- [ ] **Step 2: `docs/roadmap.md`** — mark done (with today's date) the three backlog items: schema-sync check, partial unique index, demo-seed test robustness; remove the "known dev nit" workaround note or mark it resolved by the window-scoped test.

- [ ] **Step 3: Dispatch the repo `code-reviewer` agent** on the working tree / new commits; address findings.

- [ ] **Step 4: Final verification** — run all three touched-area suites one last time (`dotnet test`, `pytest` with DB, `ruff`) and paste output; then commit docs:

```bash
git add dataplane/CLAUDE.md docs/roadmap.md
git commit -m "docs: schema-sync check + pending index recorded; CI integration job documented"
```
