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
| `src/pricepilot/scrapers/` | per-OTA scraper modules + `SCRAPERS` registry |
| `src/pricepilot/ingest/` | events, holidays, INS tourism stats, weather |
| `src/pricepilot/engine/rules/` | pure pricing rules, ordered in `RULES` |
| `src/pricepilot/engine/pipeline.py` | combines rule adjustments into a price |
| `src/pricepilot/engine/explainer.py` | builds the `factors` JSON (contract shape) |
| `src/pricepilot/scheduler/` | APScheduler enqueues + jobs-table polling worker |
| `tests/fixtures/` | saved HTML for scraper tests — never live sites |

## Commands

```powershell
py -3.12 -m venv .venv                                # once
.venv\Scripts\python -m pip install -e ".[dev]"       # once (and on dep changes)
.venv\Scripts\python -m pytest                        # tests
.venv\Scripts\python -m ruff check src tests          # lint
```

(Linux/CI: `python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"` etc.)

## Conventions

- **Money is `Decimal`, never float.** Quantize prices with `ROUND_FLOOR` /
  `ROUND_DOWN` — recommended prices round DOWN to whole currency units, never
  above the computed cap (see `recommendation-factors.md`). Currency travels
  with every amount.
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
