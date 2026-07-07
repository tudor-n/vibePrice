# feat(dataplane): public-holiday `demand_signals` ingestion (Wave 2.3)

Turns `handle_ingest_demand_signals` from a stub into a real, idempotent ingestion:
the **first working `demand_signals` producer**. Romanian public holidays are written
into the backend-owned, city-scoped `demand_signals` table as `public_holiday` flags.
Fully local/deterministic — no external API, no scraping, no schema change, no
cross-runtime coordination.

Plan: `docs/superpowers/plans/2026-07-07-demand-signals-holidays-ingestion.md`.

## What changed

| Area | Change |
|---|---|
| `ingest/demand_signals.py` (new) | `DemandSignalRecord`, `demand_signal_row_id` (deterministic `uuid5` of `city\|signal_type\|signal_date`), and `upsert_demand_signals` (`INSERT … ON CONFLICT (id) DO UPDATE`). Mirrors `ingest.events`. |
| `ingest/holidays.py` | `holiday_signal_records` + `supported_holiday_records` (skips unsupported years, logged) map holidays → `public_holiday` flags (`value=Decimal("1")`, `source="holidays"`); `ingest_holidays` orchestration covers the years the ~90-day horizon touches. |
| `scheduler/jobs.py` | `handle_ingest_demand_signals` wired to `ingest_holidays` (was a stub); returns `{"city", "signals_written"}`, mirroring `handle_ingest_events`. |
| `demo/seed.py` | Demo seeder now emits holiday signals (idempotent); adds `demand_signals_written` to the summary. |
| tests | New unit tests (`tests/test_ingest_demand_signals.py`), new integration test (`tests/integration/test_demand_signals_holidays.py`), extended `test_engine_e2e.py` idempotency assertion. |
| docs | `docs/roadmap.md` (Wave 2.3), `dataplane/CLAUDE.md` module map. |

## Scope boundary (important for reviewers)

- **Write path only.** No engine rule consumes holidays yet, so **recommendations and the
  web app are unchanged** — the signals sit in `demand_signals` waiting for a consumer.
  Engine consumption is a deliberate, separate follow-up (see roadmap backlog).
- **No schema/contract change.** `demand_signals` shape is unchanged, so there is **no EF
  migration** and no `table-ownership.md` / `recommendation-factors.md` change — this is
  expected, not a missing migration.
- `demand_signals` is **city-scoped, not tenant-scoped** — no tenant filter is expected
  (per `shared/contracts/table-ownership.md`).

## Verification

- `pytest` (full dataplane suite, DB up): **94 passed, 0 skipped** — integration tests ran
  against the EF-migrated dev Postgres.
- `ruff check src tests`: **clean**.
- End-to-end dispatch via `poll_once`: job → `succeeded`, result
  `{"city":"sibiu","signals_written":16}`; 16 `public_holiday` rows in `demand_signals`
  (matches the 2026 holiday count).
- Schema-sync integration test still **green** (no schema change).
- Backend untouched — no `dotnet` build required.
- Code-reviewer agent: **APPROVE** (no blockers/majors). Its one note — the coverage
  docstring slightly overstated cross-year coverage given the 2026-only source — was
  addressed by making the docstring honest.

## Notes

- The plan named the unit and integration test files identically
  (`test_ingest_demand_signals.py`); that collides under this repo's pytest import mode
  (no `__init__.py`), so the integration file was renamed to
  `test_demand_signals_holidays.py` (unique basename, consistent with the other
  integration tests).

## Follow-ups (not in this PR)

1. **Engine consumption of holidays** — a holiday / holiday-weekend rule or demand factor;
   this is what actually moves prices and would surface in the web app.
2. **`holidays` PyPI package** — replace the hardcoded 2026 list so any year works.
3. INS Tempo tourism stats → `avg_occupancy_by_month`; weather ingestion.
