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

### Known dev-environment nit (not a code bug)

`test_demo_seed_is_idempotent` fails against a dev DB volume that was seeded on an
earlier day: past-dated `scraped_rates` rows fall out of the 120-day window and inflate
the count (369 vs 360). Fails on `main` too. Fix either way:
`docker compose exec db psql -U pricepilot -d pricepilot -c "DELETE FROM scraped_rates WHERE stay_date < current_date;"`
(agents are not permitted to run this) — or pick up the backlog item to make the test
window-scoped.

## Backlog (ordered roughly by value)

- [x] End-to-end demo doc: `docs/demo.md` (compose/local, seed, engine run, login)
- [ ] Schema-sync check (CI): SQLAlchemy models vs EF migration column diff — drift bit twice already (wave 2, wave 2.1); `dataplane/tests/test_tables.py` now pins some column sets, a full generated diff would close the class
- [ ] Partial unique index on pending recommendations `(room_type_id, stay_date)` — deferred from wave-2 review ("consider before scaling workers"); backend-owned migration + SQLAlchemy note
- [ ] Make `test_demo_seed_is_idempotent` robust to stale dev volumes (scope rate count to the current seed window) — see wave-2.1 known nit
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
