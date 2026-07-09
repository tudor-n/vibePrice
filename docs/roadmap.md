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

## Wave 3 (real market data & watercolor UI) — landed 2026-07-08

Spec: `superpowers/specs/2026-07-08-wave-3-market-data-and-watercolor-ui-design.md` ·
plan: `superpowers/plans/2026-07-08-wave-3-market-data-and-watercolor-ui.md` · ADR 0004.

- [x] **Scraping pipeline (Part A)**: scrapers fully pure (`SearchScraper`: plan_request
  + parse_listings); ALL network I/O in `PoliteClient` (jittered delay, bounded retries,
  403/429/challenge → `ScraperBlockedError`, never retried); Booking.com city-search
  parser against realistic `data-testid` fixture; significant-token competitor matching
  (unmatched surfaced per run); orchestrator persists append-only `scraped_rates` +
  per-source `scrape_runs` (succeeded iff ≥1 rate; no competitors → no run row; wrong
  currency dropped, aggregated per offender); real `handle_scrape_competitor_rates`
  (property/city/all scope); capture + dry-run CLIs for human-in-the-loop iteration.
- [x] **Job payload isolation (backend)**: POST /jobs validates payload `property_id`
  (tenant-filtered 404) AND `tenant_id` (must equal caller's; review finding) — job
  payloads cannot trigger work for another tenant. openapi.yaml documents 400/404.
- [x] **Demand signals (Part B)**: RO public holidays via `holidays` package (any year)
  + Open-Meteo 16-day forecast (temp max, precipitation; verified against the live API)
  → idempotent uuid5 upserts into `demand_signals` (`created_at` refresh = freshness);
  real `handle_ingest_demand_signals` (all-or-nothing; no-coords cities skip weather).
- [x] **Factors v2**: `competitor_position` emits `band_low`/`band_high` (iff
  sample_size > 0); `ENGINE_VERSION="2"`; contract changelog added; renderer tolerant
  of v1 rows.
- [x] **Watercolor UI (Part C, design handoff)**: handoff palette + self-hosted DM Serif
  Display/Spectral; animated login townscape (SVG, reduced-motion aware); teal sidebar
  shell + village illustration; dashboard greeting/corner-art cards; month price
  calendar from factors v2 band (pure `calendarModel`, markers 0.42/0.72, pending cells
  scroll to their card); illustrated empty state. **Refresh button fixed**: `refresh_all`
  (always rejected by the API) → real sequence scrape → ingest.events → engine.
  A11y-hardened beyond the handoff (AA contrast, ≥13px captions, no fake controls).
- [x] Verified: dataplane 168/168 (integration against migrated Postgres, incl. jobs
  pipeline smoke: claim → handler → succeeded results), backend 47/47 (0 warnings),
  web 74/74 + typecheck + build; compose config valid; live Open-Meteo sanity check;
  179 pending v2 recommendations regenerated on the dev DB.
- [x] Code review (A+B): REQUEST CHANGES → all four actionable findings fixed and
  self-verified with green suites (tenant_id trigger gap + 4 tests, openapi 400/404,
  capture gitignore, issue aggregation); finding 4 (multi-city `scrape_runs.city` +
  scoped freshness) deferred to backlog. Code review (C): **APPROVE**; all six
  improvement findings applied anyway (13px event pill, dead CSS removed, refresh
  failure-path test, weekday header exposed to SRs, band currency guard, per-room
  month bounds). Final: web 75/75, backend 47/47, dataplane 168/168.

**Booking.com live-run status:** the pipeline is fixture-verified end-to-end; the live
site needs human-in-the-loop iteration (anti-bot). Loop:
`python -m pricepilot.scrapers.capture booking --city sibiu` → inspect/trim → fix
selectors → `python -m pricepilot.scrapers.run --city sibiu --days 7` → `--write`.

## Google Places foundation — landed 2026-07-09

Spec: `superpowers/specs/2026-07-08-google-places-foundation-design.md`. First of
four subsystems decomposed from the owner's "tie locations to Google reviews +
proximity" vision — the data foundation the later pricing rules build on.

- [x] **Schema**: `properties`/`competitors` gain seven place columns each
  (`place_id`, `latitude`, `longitude` `numeric(9,6)`, `rating` `numeric(2,1)`,
  `rating_count`, `place_resolved_at`, `place_candidates jsonb`) plus
  `discovered_at`/`discovery_source`/`excluded_at` on `competitors`
  (`source_url` now nullable); new city-scoped `points_of_interest` table (not
  tenant-scoped, like `events`). EF migration + SQLAlchemy mapping +
  `table-ownership.md` in the same commit; `tests/test_tables.py` /
  `test_schema_sync.py` pin it.
- [x] **Provider seam (dataplane)**: `pricepilot/places/` — `PlacesProvider`
  protocol (`text_search`/`details`/`nearby`), `GoogleAdapter` (live, keyed by
  `GOOGLE_PLACES_API_KEY`, never called in tests) and `FixtureAdapter`
  (replays packaged `src/pricepilot/places/fixtures/*.json`); provider chosen by
  `PLACES_PROVIDER` (default `fixture` — no live call without opt-in);
  coordinates/ratings parsed straight to `Decimal` at the adapter boundary;
  human-in-the-loop `capture` CLI mirrors the scraper one.
- [x] **Jobs**: `resolve_place {property_id}` (text-search, auto-pick top
  match, write place fields + top-5 `place_candidates`, chain-enqueue
  `discover_competitors`; unresolved+`__failed__` sentinel on no result) and
  `discover_competitors {property_id}` (`nearby` lodging search, `uuid5`
  idempotent upsert, excludes the property's own place and tombstoned rows,
  capped at `COMPETITOR_DISCOVERY_MAX` with dropped-overflow logging). Both
  contract-first in `jobs.md`, both idempotent.
- [x] **Backend endpoints**: `POST /properties {name, city}` (enqueues
  `resolve_place`, no more manual competitor create), `PATCH
  /properties/{id}/place` (owner picks a stashed candidate; 400 on unknown
  `place_id`), `POST /properties/{id}/resolve-place` (re-search), `GET
  /properties/{id}/competitors` (discovered list, excludes tombstoned),
  `DELETE /competitors/{id}` (soft-delete → `excludedAt`, no hard delete),
  `GET /points-of-interest?city=`. Every lookup tenant-filtered; foreign ids →
  404 not 403. `openapi.yaml` + new `place-candidates.md` contract note.
- [x] **Web UX**: Settings "Add your property" (name + city only) → resolving
  → resolved (address, ★rating, review count, map-pin chip) → failed-with-retry
  states; "Not the right place?" candidate picker + free-text re-search;
  Competitors page is now a read-only discovered list (rating, review count,
  distance) with per-row Untrack + confirm — no add form.
- [x] **POI seed**: idempotent deterministic-id seed for Sibiu (Piața Mare
  w100, Piața Mică w90, Podul Minciunilor w70, Muzeul Brukenthal w80, Centru
  istoric/old-town centroid w100) on backend startup; read-only endpoint above.
- [x] **Demo**: `docs/demo.md` "Google Places foundation" walkthrough (enter
  property → resolve → auto-discover competitors → untrack → POI read) using
  `PLACES_PROVIDER=fixture` (deterministic, free); real demo path documented
  (`capture` CLI + `PLACES_PROVIDER=google`).
- [x] Verified: backend 66/66 (0 warnings), dataplane 175 passed / 14 skipped
  (DB-only integration, incl. `test_place_jobs.py`, `test_places_provider.py`)
  + ruff clean, web 97/97 + typecheck + build — 2026-07-09. Dev-DB migration
  apply, dataplane integration/schema-sync against the migrated DB, and the
  manual API smoke are human-in-the-loop steps (agents are permission-blocked
  from dev-DB writes) — see the pre-merge checklist in the task-10 report.

**Still deferred** (explicitly out of scope for this slice, per the design's
non-goals): the **reviews pricing rule** (own vs. competitor reputation →
`adjustment_pct`), the **proximity pricing rule** (property ↔ weighted POIs →
`adjustment_pct`), **self-service account signup**, **live Google adapter
verification** against a billing-enabled key (human-in-the-loop, like the
Booking scraper live-verify), and a separate **UX/accessibility overhaul**.

## Usability overhaul — landed 2026-07-09

Spec: `superpowers/specs/2026-07-09-usability-overhaul-design.md` · plan:
`superpowers/plans/2026-07-09-usability-overhaul.md`. Addresses the
"separate UX/accessibility overhaul" the Google Places foundation above
flagged as deferred — owner's brief: make the app "foolproofed and
incredibly obvious and intuitive" for non-technical hotel owners.

- [x] **Guided onboarding wizard**: full-screen `/setup` route (outside the
  main Layout), auto-entered by a logged-in owner with zero properties.
  Five one-thing-per-screen steps — ① hotel name + town (creates the
  property, fires `resolve_place`) → ② "Which one is you?" (`PlacePicker`
  over the top-5 Google candidates, or search-again) → ③ your room + nightly
  rate (new room-type endpoint) → ④ "Finding hotels near you…" (auto
  `discover_competitors`, no manual entry) → ⑤ your first price (runs
  scrape→events→engine, shows the first recommendation card). Resumes at the
  correct step on reload by reading real server state (`useSetupProgress`/
  `deriveStep` — no client-duplicated truth); a quiet "Skip for now" never
  traps the owner; the dashboard keeps a "Finish setting up"/"Start setup"
  nudge until a property **and** a room type both exist.
- [x] **Async transparency**: shared `AsyncStatus` component (working → done
  → **slow** timeout escalation → failed; `aria-live="polite"`, plain copy,
  never a dead-end spinner — "Try again" / "Keep working in the
  background"). Applied at wizard steps ②/④/⑤, the dashboard's **"Check for
  new prices"** button (was "Refresh data now" — now real 3-step progress
  `Prices ✓ · What's on ✓ · Recalculating…` instead of a bare "queued"), and
  Settings' property card (folded its bespoke resolving/failed states onto
  the same primitive, gaining the SLOW escalation it lacked before).
- [x] **Plain-language rewrite**: one warm, second-person voice across nav
  (**Home / Prices to review / Nearby hotels / What's on / Your hotel** —
  labels only, routes unchanged), Home, Prices to review, Nearby hotels,
  What's on, Your hotel, login, the wizard, and shared components; jargon
  metrics ("competitor band", "estimated total impact") got plain rewrites
  plus an inline `Explainer` ("?" popover, keyboard-reachable, dismissible);
  empty states are now buttons that do the obvious next thing instead of a
  sentence pointing at a menu.
- [x] **Backend — room-type create**: `POST /properties/{id}/room-types`
  (name/capacity/basePrice validated at the endpoint layer, `currentPrice`
  defaults to `basePrice`, `currency` defaults `RON`; tenant-scoped, foreign
  id → 404 not 403); `openapi.yaml` + `web/src/api/types.ts` updated in the
  same commit. Demo seed gained a second, intentionally-empty tenant/user
  (`new@pricepilot.local` / `Demo1234!`, `shared/contracts/demo-seed.md`) so
  the brand-new-owner flow is always reachable without hand-seeding.
- [x] **Accessibility**: focus moves to each wizard step's heading on
  advance; ≥44px primary actions; visible focus; real labels on every
  control; `prefers-reduced-motion` honored on the animated working states.
- [x] **Demo**: `docs/demo.md` "Usability overhaul — guided onboarding"
  walkthrough (log in as the empty seed account → auto-route to `/setup` →
  all 5 steps → Home), using the same `PLACES_PROVIDER=fixture` determinism
  as the Google Places section.
- [x] Verified: backend 75/75 unit tests (1 integration test skipped — no
  Postgres in this environment; 0 build warnings); web 176/176 tests +
  typecheck + build; dataplane sanity re-run 175 passed / 14 skipped
  (unaffected — no dataplane code changed this slice). Per-task code review
  (tasks 1–6) landed clean, see `.superpowers/sdd/progress.md`; the
  full-stack manual smoke and the final whole-branch review/PR are
  human/controller steps, not yet run — checklist in the task-7 report.

**Still deferred** (explicit non-goals of this slice, per the design):
**live typeahead place search** (picker B — a dropdown that updates as you
type; needs a synchronous search path, not yet architected), **self-service
account signup** (still login-only with seeded users), **room-type
editing** + a **Settings "Add room" form** (so multi-property owners can add
a room to hotel #2+ without going through the single-property wizard) + the
**accept-a-recommendation-sets-`current_price` loop** (wave-4 proper — see
`superpowers/specs/2026-07-08-wave-4-owner-self-service-design.md`, on
hold), the **reviews / proximity pricing rules**, and **i18n** (copy stays
English; translation itself is a later concern).

## Backlog (ordered roughly by value)

- [x] End-to-end demo doc: `docs/demo.md` (compose/local, seed, engine run, login)
- [x] Schema-sync check (CI): SQLAlchemy models vs migrated schema diff — wave 2.2
- [x] Partial unique index on pending recommendations `(room_type_id, stay_date)` — wave 2.2
- [x] `test_demo_seed_is_idempotent` robust to stale dev volumes — wave 2.2
- [x] Real Booking.com scraper pipeline (pure parser, polite client, matching,
  orchestrator, CLIs) — wave 3. **Remaining: live-verify against real markup/anti-bot
  (human-in-the-loop; loop documented under wave 3)**
- [x] Weather ingestion via open-meteo (`ingest/weather.py`) — wave 3
- [x] RO public holidays into demand_signals (`holidays` package) — wave 3
- [ ] Airbnb scraper (search is client-rendered; needs browser-based fetcher or API behind the same pure interface)
- [ ] INS Tempo tourism statistics ingestion (`ingest/tourism_stats.py`)
- [ ] Events calendar scraping (replace StaticSibiuEventSource)
- [ ] Hotel own-booking history import (CSV) → occupancy signal into engine
- [ ] `scrape_runs.city` column + city-scoped freshness in `_load_rule_contexts`
  (A+B review finding 4; needed before a second city onboards — EF migration +
  SQLAlchemy + table-ownership.md in one PR)
- [ ] Holiday/weather engine rules consuming demand_signals (factors contract bump)
- [ ] Email notification connector (real SMTP) + weekly digest
- [ ] WhatsApp connector (Meta Business API)
- [ ] Recommendation accept → track outcomes; feedback loop dataset
- [ ] Romanian i18n for dashboard (owners are the audience)
- [ ] Billing (Stripe) + subscription enforcement
- [ ] VPS deployment: reverse proxy + TLS (Caddy), backups, monitoring
- [ ] ML demand index (`engine/forecast/`) as pipeline input — after real data accumulates
- [ ] Channel price push (Booking/Airbnb connectors) — requires partner API access
