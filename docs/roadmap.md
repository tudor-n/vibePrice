# Roadmap

Living document — update when work lands. Conventions: `[x]` done+verified, `[~]` in progress, `[ ]` todo.

## Done

- [x] Design spec approved (`superpowers/specs/2026-07-04-pricepilot-design.md`) — 2026-07-04
- [x] Root scaffold: contracts, docker-compose, CI, CLAUDE.md guides, ADRs 0001-0003 — 2026-07-04
- [x] Backend scaffold: 5-project solution, all entities, EF InitialCreate migration, all openapi.yaml endpoints, tenant global query filters, connector seams; 12 unit tests — 2026-07-04
- [x] Dataplane scaffold: SQLAlchemy mappings, 5 pricing rules implemented (pure functions), pipeline with Decimal arithmetic + floor guard, explainer per factors contract, atomic job claiming (SKIP LOCKED), APScheduler + polling loop; 39 tests — 2026-07-04
- [x] Web scaffold: all 5 pages, RecommendationCard with factors reasoning, react-query hooks, freshness badges; 14 tests — 2026-07-04

## Wave 2 (demo-ready end-to-end) — landed 2026-07-04

- [x] Backend: POST /auth/login (JWT HS256, PasswordHasher, 10/min rate limit, uniform 401s), idempotent demo seeding (`Demo__SeedOnStartup`, fixed UUIDs from `shared/contracts/demo-seed.md`) — 19 unit tests
- [x] Dataplane: `_load_rule_contexts` reads real data from Postgres; idempotent recommendation persistence (pending replaced, decided preserved); `ingest.events` persists static Sibiu events (uuid5 upsert); deterministic demo rates `python -m pricepilot.demo.seed`; SQLAlchemy mapping drift vs migration fixed — 64 tests incl. 4 live integration
- [x] Web: login page (RO error string, dev credentials hint), Bearer client + 401 handling, route guard, real property selector via context — 37 tests
- [x] HTTP e2e smoke passed: login → 1 property → 64 recommendations (1-month window, all 5 factor rules) → 3 events; wrong tenant sees 0 properties
- [x] Wave-2 code review (repo code-reviewer rules) — verdict REQUEST CHANGES, findings saved below, NOT yet fixed

## Wave 2.1 (review fixes) — landed 2026-07-07

All six wave-2 review findings fixed; code-reviewer re-run verdict **APPROVE** (no majors).

- [x] **users.email**: unique index (`ix_users_email`, migration `20260707050444_AddUsersEmailUniqueIndex`) + normalized-email invariant (`User.NormalizeEmail`, trim+lowercase, applied on every write path and at login); SQLAlchemy mapping annotated `unique=True`; `table-ownership.md` updated. Tests: `UserEmailTests`, mixed-case login in `LoginEndpointTests`.
- [x] **Rate limiter behind proxy**: `ForwardedHeadersSetup.cs` — opt-in `ForwardedHeaders__Enabled` + `KnownProxies`/`KnownNetworks` (fail-fast on bad/missing config), X-Forwarded-For only, applied before `UseRateLimiter`. Limiter stays IP-only (email partition rejected: partition callback is sync, no parsed body). **Deploy note: behind Caddy these env vars are REQUIRED** (`.env.example`, `backend/CLAUDE.md`).
- [x] **JWT key guard**: ≥32 UTF-8 bytes enforced at startup (every environment) + `JwtTokenIssuer` constructor guard. Tests: `JwtKeyGuardTests`.
- [x] **tables.py drift**: `OwnBooking.source` added, phantom `OwnBooking.created_at` removed (would fail at runtime), `Event.name` → String(300); new `tests/test_tables.py` pins column sets against the migration.
- [x] **Past-pending purge**: engine replace-delete now also removes pending rows with `stay_date < today` for in-scope room types, same transaction; decided rows structurally excluded. Test: `test_rerun_purges_past_pending_but_never_past_decisions`.
- [x] **Serialization boundary**: `to_jsonable` allowlists JSON-native scalars and raises `TypeError` otherwise (temporals must be `.isoformat()`ed first — explainer already does); explainer docstring points at the real boundary.

Verified: backend `dotnet test` 36/36; dataplane `pytest` 76 passed / 1 environmental failure (below); `ruff` clean; migration applied to dev DB.

### Known dev-environment nit — RESOLVED in wave 2.2

`test_demo_seed_is_idempotent` used to fail against dev DB volumes seeded on an earlier
day (stale past-dated `scraped_rates` inflating a global count). The test is now
window-scoped; stale rows in dev volumes are harmless. (Optional cleanup if you want a
tidy volume: `DELETE FROM scraped_rates WHERE stay_date < current_date;`.)

## Wave 2.2 (schema-sync guard) — landed 2026-07-07

Spec: `superpowers/specs/2026-07-07-schema-sync-check-design.md` · plan:
`superpowers/plans/2026-07-07-schema-sync-check.md`.

- [x] **Schema-sync check**: pure drift diff `dataplane/db/schema_check.py` (mapped
  columns must exist with matching type/nullability everywhere; dataplane-WRITTEN tables
  must be fully mapped; backend-only tables may be partial) + integration test
  `test_schema_sync.py` reflecting the live schema. First run surfaced and fixed real
  drift: 4× `currency` mapped `String(3)` vs `char(3)` in the DB.
- [x] **CI `dataplane-integration` job**: Postgres 17 service + backend EF migrations
  applied via dotnet tooling, then the full dataplane suite with
  `PRICEPILOT_REQUIRE_DB=1` (unavailable DB = hard collection error, never a skip —
  shared probe `tests/integration/dbprobe.py`). Integration tests now run in CI at all.
- [x] **Partial unique index on pending recommendations** (deferred wave-2 "consider"):
  migration `20260707053900_AddPendingRecommendationUniqueIndex` — unique
  `(room_type_id, stay_date) WHERE status = 'pending'`; plain `room_type_id` FK index
  kept explicitly (a partial index can't serve decided-row lookups). Contract note in
  `table-ownership.md`.
- [x] **Window-scoped `test_demo_seed_is_idempotent`** — stale dev volumes no longer
  fail the suite.

Verified: dataplane 86/86 passed (first fully green DB-backed run) + ruff clean;
backend 37/37, build 0 warnings; both migrations applied to the dev DB; workflow
linted with actionlint.

## Backlog (ordered roughly by value)

- [x] End-to-end demo doc: `docs/demo.md` (compose/local, seed, engine run, login)
- [x] Schema-sync check (CI): SQLAlchemy models vs migrated schema diff — wave 2.2
- [x] Partial unique index on pending recommendations `(room_type_id, stay_date)` — wave 2.2
- [x] `test_demo_seed_is_idempotent` robust to stale dev volumes — wave 2.2
- [ ] Real Booking.com scraper (live fetch + anti-bot handling; parser pattern exists) — needs human-in-the-loop iteration
- [ ] Airbnb scraper
- [ ] INS Tempo tourism statistics ingestion (`ingest/tourism_stats.py`)
- [ ] Weather ingestion via open-meteo (`ingest/weather.py`)
- [ ] Events calendar scraping (replace StaticSibiuEventSource)
- [ ] Hotel own-booking history import (CSV) → occupancy signal into engine
- [ ] Email notification connector (real SMTP) + weekly digest
- [ ] WhatsApp connector (Meta Business API)
- [ ] Recommendation accept → track outcomes; feedback loop dataset
- [ ] Romanian i18n for dashboard (owners are the audience)
- [ ] Billing (Stripe) + subscription enforcement
- [ ] VPS deployment: reverse proxy + TLS (Caddy), backups, monitoring
- [ ] ML demand index (`engine/forecast/`) as pipeline input — after real data accumulates
- [ ] Channel price push (Booking/Airbnb connectors) — requires partner API access
