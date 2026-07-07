# dataplane/ — agent guide

Python side of PricePilot: scrapes competitor rates, ingests public demand data,
runs the explainable pricing engine, and schedules/executes jobs. Talks to the
backend only through PostgreSQL and the `jobs` table (`shared/contracts/`).

## Module map

| Path | Purpose |
|---|---|
| `src/pricepilot/config.py` | pydantic-settings `Settings` from env (12-factor) |
| `src/pricepilot/db/session.py` | lazy engine + session factory |
| `src/pricepilot/db/tables.py` | SQLAlchemy mappings of the backend-owned schema |
| `src/pricepilot/db/schema_check.py` | drift diff: mappings vs reflected DB schema (CI-enforced) |
| `src/pricepilot/scrapers/` | per-OTA scraper modules + `SCRAPERS` registry |
| `src/pricepilot/ingest/` | events, holidays, INS tourism stats, weather |
| `src/pricepilot/engine/rules/` | pure pricing rules, ordered in `RULES` |
| `src/pricepilot/engine/pipeline.py` | combines rule adjustments into a price |
| `src/pricepilot/engine/explainer.py` | builds the `factors` JSON (contract shape) |
| `src/pricepilot/engine/serialization.py` | Decimal→JSON boundary for JSONB persistence |
| `src/pricepilot/scheduler/` | APScheduler enqueues + jobs-table polling worker |
| `src/pricepilot/demo/seed.py` | idempotent demo seeder (`shared/contracts/demo-seed.md`) |
| `tests/fixtures/` | saved HTML for scraper tests — never live sites |
| `tests/integration/` | DB-backed e2e tests (`integration` marker, auto-skip when DB down) |

## Commands

```powershell
py -3.12 -m venv .venv                                # once
.venv\Scripts\python -m pip install -e ".[dev]"       # once (and on dep changes)
.venv\Scripts\python -m pytest                        # tests
.venv\Scripts\python -m ruff check src tests          # lint
```

(Linux/CI: `python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"` etc.)

### Integration tests + demo seed (dev database)

Integration tests live in `tests/integration/`, are marked `integration`, and
auto-skip when the database is unreachable (2s probe) or migrations are missing
(shared probe: `tests/integration/dbprobe.py`). CI runs the full suite against
an EF-migrated Postgres in the `dataplane-integration` job with
`PRICEPILOT_REQUIRE_DB=1` — there an unavailable DB is a hard failure, never a
skip. The schema-sync check (`tests/integration/test_schema_sync.py`) fails on
any drift between `db/tables.py` and the migrated schema — fix the mapping,
never emit DDL. To run integration tests locally:

```powershell
# 1. Postgres (repo root)
docker compose up -d db

# 2. Schema — backend owns it; apply EF migrations (read-only use of backend tooling)
cd backend
dotnet tool restore
dotnet tool run dotnet-ef database update --project src/PricePilot.Infrastructure `
  --startup-project src/PricePilot.Api `
  --connection "Host=localhost;Port=5432;Database=pricepilot;Username=pricepilot;Password=devpassword"

# 3. Tests (dataplane) — DATABASE_URL defaults to the docker dev DB when unset
cd ..\dataplane
$env:DATABASE_URL = "postgresql+psycopg://pricepilot:devpassword@localhost:5432/pricepilot"
.venv\Scripts\python -m pytest
```

Demo seed (dataplane-owned tables per `shared/contracts/demo-seed.md`: events,
120 days of scraped_rates for the 3 fixed competitors, one succeeded scrape_run):

```powershell
.venv\Scripts\python -m pricepilot.demo.seed   # idempotent; needs DATABASE_URL as above
```

The seeder requires the backend-owned demo rows (tenant/property/room
types/competitors). Until the backend demo seeder ships, running the
integration tests once (`pytest tests/integration`) inserts them as a test
fixture stand-in with the contract's fixed UUIDs.

## Conventions

- **Money is `Decimal`, never float.** Quantize prices with `ROUND_FLOOR` /
  `ROUND_DOWN` — recommended prices round DOWN to whole currency units, never
  above the computed cap (see `recommendation-factors.md`). Currency travels
  with every amount.
- **Decimal→JSONB boundary**: the factors payload is persisted via
  `engine/serialization.py::to_jsonable` — Decimals quantized to 2dp then
  emitted as JSON numbers (floats exist ONLY in the serialized payload, never
  in computation; lossless for `numeric(10,2)` — tested in
  `tests/test_serialization.py`). The boundary is strict: unknown types raise
  `TypeError` there; convert dates/datetimes to ISO strings first (the
  explainer already does).
- **Idempotent writes**: seeder/ingest rows use deterministic `uuid5` ids from
  natural keys (events: city+name+start_date; demo rates:
  competitor_id+stay_date) with `INSERT ... ON CONFLICT (id) DO UPDATE`.
  The engine replaces PENDING recommendations per (room_type_id, stay_date),
  purges past-dated PENDING rows for the in-scope room types in the same
  transaction, and never touches accepted/dismissed rows regardless of date.
- **Engine rules are pure functions**: `RuleContext` in, `FactorResult` out,
  no I/O, no clocks, no randomness. Every branch returns a human-readable
  English `reason`.
- Stay dates are `date`; instants are UTC `timestamptz` (`*_at`).

### Adding an engine rule (checklist)

1. Create `engine/rules/<name>.py` with a pure `apply(ctx) -> FactorResult`.
2. Give every branch a `reason` string (including the zero-adjustment branch).
3. Register it in `engine/rules/__init__.py` `RULES` (order = payload order).
4. Add boundary tests in `tests/test_rules.py` (edges, no-data, zero cases).
5. If the factor adds new JSON keys, update
   `shared/contracts/recommendation-factors.md` in the same PR and bump
   `ENGINE_VERSION` if the shape changes.

### Scrapers

- Tests use saved HTML fixtures in `tests/fixtures/` **only** — never live
  sites (repo hard rule). `parse` is pure; `fetch` does the I/O.
- One module per source, registered in `SCRAPERS`. Keep sources isolated:
  they are fragile, expect breakage, and each must be swappable for a paid
  rate API without touching the rest.
- When markup changes, re-capture the fixture and fix the parser together.

### Schema

- `db/tables.py` **maps** the backend-owned schema; it must **never emit DDL**
  (no `create_all`, no Alembic). The C# backend owns all migrations.
- Any schema change = backend EF Core migration + SQLAlchemy model +
  `shared/contracts/table-ownership.md` update in the same PR.
- Tenant isolation: every query on tenant-owned tables takes explicit
  tenant/property scope.

### Jobs

- Job types/payloads are defined in `shared/contracts/jobs.md` — update it
  first when adding a type, then add a handler to `scheduler/jobs.py` `HANDLERS`.
- Claiming is atomic (`UPDATE ... FOR UPDATE SKIP LOCKED ... RETURNING`);
  never poll-then-update in two steps.
- Handlers must be idempotent: re-running a succeeded job is always safe.
