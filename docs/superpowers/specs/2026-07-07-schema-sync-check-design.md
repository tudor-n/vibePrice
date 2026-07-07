# Schema-sync check + schema hygiene — design

Date: 2026-07-07 · Status: approved (user delegated design choice this session)

## Problem

The SQLAlchemy mappings in `dataplane/src/pricepilot/db/tables.py` mirror the schema
that backend EF Core migrations own. Drift between the two has caused real bugs twice
(wave 2: mapping vs migration column differences; wave 2.1: phantom
`OwnBooking.created_at` that would crash any SELECT through the mapping, missing
`OwnBooking.source`, wrong `Event.name` length). The only guard today is
`dataplane/tests/test_tables.py`, which pins a few hand-picked column sets — it catches
the instances we already noticed, not the class.

Additionally, CI never exercises the dataplane integration suite (no Postgres service in
the workflow), and two smaller items ride along: the wave-2 review's deferred partial
unique index on pending recommendations, and `test_demo_seed_is_idempotent` being flaky
against dev DB volumes seeded on an earlier day.

## Approaches considered

1. **Reflect the live migrated database and diff it against `Base.metadata`** —
   integration test plus a CI job that applies EF migrations to a service Postgres.
   Ground truth is the schema the migrations actually produce; catches both drift
   directions; reuses the existing probe/skip pattern. **Chosen.**
2. Statically parse `AppDbContextModelSnapshot.cs` and compare — no DB needed, but
   parsing C# from Python is fragile and becomes its own maintenance burden.
3. Commit a schema dump artifact from the backend and diff against it — decouples the
   runtimes in CI but the committed artifact is a new thing that can go stale, i.e. a
   new drift vector.

## Design

### 1. Pure diff function: `dataplane/src/pricepilot/db/schema_check.py`

`diff_schema(declared: MetaData, reflected: MetaData) -> list[str]` — pure, no I/O,
returns one human-readable drift string per problem (empty list = in sync). Unit-testable
without a database by building two `MetaData` objects by hand (TDD).

Comparison rules, per table declared in `Base.metadata`:

- Table must exist in the reflected metadata (missing table = drift).
- Every **mapped column** must exist in the DB — a column mapped but absent crashes at
  runtime (the phantom `OwnBooking.created_at` class). Applies to all tables.
- A DB column **absent from the mapping** is drift only for **dataplane-written tables**
  (`scraped_rates`, `scrape_runs`, `events`, `demand_signals`, `recommendations`,
  `own_bookings`, `jobs` — per `table-ownership.md`): there an unmapped NOT NULL column
  breaks INSERTs (the `OwnBooking.source` class). Backend-only tables are deliberately
  partially mapped (dataplane reads a subset and never writes them), so missing columns
  are allowed there.
- Per mapped column: **type** and **nullability** must match. Types compare by compiling both
  sides against the PostgreSQL dialect (`type.compile(dialect)`) and normalizing the
  strings (upper-case, collapse whitespace), with a small alias table for spellings the
  reflection layer produces (e.g. `TIMESTAMP WITH TIME ZONE`). Length/precision/scale are
  part of the compiled string, so `VARCHAR(200)` vs `VARCHAR(300)` is drift.

Deliberately out of scope for v1 (noisy, low bug-yield here): indexes, foreign keys,
server defaults, check constraints, tables that exist in the DB but are not declared
(`__EFMigrationsHistory` and anything else — the mapping mirrors what dataplane uses).

Known drift this check will surface on first run (fixing it is in scope): the four
`currency` columns are `character(3)` in the migration but `String(3)` (= varchar) in
`tables.py` — change the mappings to `CHAR(3)`. Any further reported drift gets fixed
in `tables.py` the same way (the database is ground truth).

### 2. Integration test: `dataplane/tests/integration/test_schema_sync.py`

Reflects the real database (`MetaData().reflect(engine)`) and asserts
`diff_schema(Base.metadata, reflected) == []`, failing with the full drift list.
Reuses the `_db_ready` probe/skip pattern from `test_engine_e2e.py` (extract the probe
into a shared helper `tests/integration/_db.py` rather than copy-pasting it).

Skip-vs-fail: locally without a DB the test **skips** (existing convention). When the
env var `PRICEPILOT_REQUIRE_DB=1` is set (the CI integration job sets it), an
unavailable database is a **hard failure**, never a skip — otherwise the CI check could
silently pass by skipping.

### 3. CI: new `dataplane-integration` job in `.github/workflows/ci.yml`

- `services: postgres:17-alpine` (matching docker-compose) with health check.
- `actions/setup-dotnet` + `dotnet tool restore` + `dotnet ef database update` from
  `backend/` against the service DB — the same "read-only use of backend tooling"
  pattern documented in `dataplane/CLAUDE.md` for local dev.
- `actions/setup-python` + `pip install -e .[dev]`, then run the **whole** dataplane
  suite with `DATABASE_URL` pointing at the service and `PRICEPILOT_REQUIRE_DB=1`.
  This runs the schema-sync check AND the engine e2e tests in CI for the first time,
  always against a fresh DB (which is also why the stale-volume flakiness class can't
  reach CI). The existing `dataplane` job stays as-is: fast, DB-less unit run.

### 4. Backend: partial unique index on pending recommendations

Deferred "consider" from the wave-2 review, included here because the schema-sync work
is the natural moment for a schema PR. EF migration `AddPendingRecommendationUniqueIndex`:

```csharp
e.HasIndex(x => new { x.RoomTypeId, x.StayDate })
 .IsUnique()
 .HasFilter("status = 'pending'");
```

The engine's replace-then-insert runs in one transaction, so the index is compatible
with today's single worker and makes concurrent workers fail loudly instead of writing
duplicate pending rows. Indexes are out of the diff's scope, so no `tables.py` type
change — but the invariant gets a comment on the `Recommendation` mapping and a line in
`shared/contracts/table-ownership.md`.

### 5. Dataplane: window-scope `test_demo_seed_is_idempotent`

Scope the rate count to the current seed window (`ScrapedRate.stay_date >=
date.today()`, matching what `demo/seed.py` writes) so past-dated leftovers in a dev
volume can't inflate the count. Verify against `seed.py`'s actual window before writing
the assertion.

## Error handling

- Diff failures print every drift line (not just the first) so one CI run reveals the
  whole gap.
- Reflection or connection errors in the integration test follow skip-vs-fail per
  `PRICEPILOT_REQUIRE_DB`.
- The EF migration is additive (index only) — no data backfill, safe on the seeded dev DB
  (engine purges past pending rows as of wave 2.1, and current data was verified unique).

## Testing

- Unit (no DB): `tests/test_schema_check.py` — in-sync case, missing table, missing
  column, extra column, type mismatch (length and kind), nullability mismatch.
- Integration: `test_schema_sync.py` green against the migrated dev DB — this is the
  moment any *existing* undetected drift surfaces; fixing whatever it reports is part of
  this work (expected candidates: `char(3)` vs `String(3)` spellings).
- Backend: `dotnet build && dotnet test`; migration applied to the dev DB.
- CI job correctness is verified by review + local simulation of its steps (fresh
  ephemeral DB via docker, `PRICEPILOT_REQUIRE_DB=1`); the workflow itself can only be
  proven on GitHub.

## Definition of done

Per repo rules: tests green in touched areas, `table-ownership.md` updated (index note),
schema change ships EF migration + SQLAlchemy comment together, code-reviewer run,
roadmap + area CLAUDE.md files updated.
