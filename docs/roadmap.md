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
- [x] Wave-2 code review (repo code-reviewer rules) — findings addressed

## Backlog (ordered roughly by value)

- [x] End-to-end demo doc: `docs/demo.md` (compose/local, seed, engine run, login)
- [ ] Schema-sync check (CI): SQLAlchemy models vs EF migration column diff — drift already bit once in wave 2
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
