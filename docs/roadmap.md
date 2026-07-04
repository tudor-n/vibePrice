# Roadmap

Living document — update when work lands. Conventions: `[x]` done+verified, `[~]` in progress, `[ ]` todo.

## Done

- [x] Design spec approved (`superpowers/specs/2026-07-04-pricepilot-design.md`) — 2026-07-04
- [x] Root scaffold: contracts, docker-compose, CI, CLAUDE.md guides, ADRs 0001-0003 — 2026-07-04
- [x] Backend scaffold: 5-project solution, all entities, EF InitialCreate migration, all openapi.yaml endpoints, tenant global query filters, connector seams; 12 unit tests — 2026-07-04
- [x] Dataplane scaffold: SQLAlchemy mappings, 5 pricing rules implemented (pure functions), pipeline with Decimal arithmetic + floor guard, explainer per factors contract, atomic job claiming (SKIP LOCKED), APScheduler + polling loop; 39 tests — 2026-07-04
- [x] Web scaffold: all 5 pages, RecommendationCard with factors reasoning, react-query hooks, freshness badges; 14 tests — 2026-07-04

## In progress (wave 2 — demo-ready end-to-end)

- [~] Backend: POST /auth/login (JWT HS256, PasswordHasher), demo tenant seeding (`Demo__SeedOnStartup`, fixed UUIDs from `shared/contracts/demo-seed.md`)
- [~] Dataplane: `_load_rule_contexts` reads real data from Postgres; recommendation persistence (idempotent, Decimal-safe JSON); `ingest.events` handler persists static Sibiu events; synthetic demo competitor rates (`python -m pricepilot.demo.seed`)
- [~] Web: login page + Bearer token auth in client, route guard, working property selector

## Backlog (ordered roughly by value)

- [ ] End-to-end demo script/doc: compose up → seed → engine run → login → see recommendations
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
