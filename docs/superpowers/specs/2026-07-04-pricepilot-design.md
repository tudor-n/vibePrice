# PricePilot — Dynamic Pricing Platform for Hotels & Guesthouses

**Date:** 2026-07-04
**Status:** Approved
**Codename:** `PricePilot` (C# namespace / Python package name; renameable)

## Vision

A subscription SaaS that gives hotels, guesthouses, and short-term rentals (Airbnb-style)
competitive, dated price recommendations with plain-language reasoning, so owners capture
more revenue during demand peaks (e.g. FITS in Sibiu) and fill rooms during low season.
Launch in Sibiu, then scale nationally and internationally.

The product must *convince* owners: every recommendation carries an explanation and an
estimated revenue impact. v1 recommends; a future version pushes prices to OTAs
automatically via channel connectors.

## v1 Scope

**In:**
- Competitor rate scraping (OTAs) — isolated, swappable per-source modules
- Public data ingestion: local events calendar, INS tourism statistics, public holidays, weather
- Explainable rules-based pricing engine with per-recommendation reasoning and revenue estimate
- Multi-tenant web dashboard: recommendations with reasoning, competitor rate calendar,
  events view, accept/dismiss actions, data freshness indicators
- Auth, tenants, properties/room types management
- Jobs table so the dashboard can trigger "refresh now"

**Out (but seams built now):**
- Email/WhatsApp notifications → `INotificationConnector` interface + no-op stubs
- OTA price push (Booking.com, Airbnb) → `IChannelConnector` interface + no-op stubs
- ML demand forecasting → becomes one more engine input later, same interface
- Hotel's own booking history ingestion → `own_bookings` table exists in schema from day one
- Billing (Stripe) → subscription fields on tenant, no payment integration yet

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Data sources | OTA scraping + public data | Paid rate APIs cost from day zero, weak coverage of small Sibiu properties. Scraping is fragile/ToS-gray → isolate it so it can be swapped for a paid API later. |
| Engine | Transparent rules + statistics | Owners trust what they understand; no per-hotel training data exists yet. ML replaces internals later behind the same interface. |
| Stack | ASP.NET Core 9 (C#) API · Python 3.12+ dataplane · React+TS dashboard · PostgreSQL | C# is the team's strong language; Python owns scraping/data/ML; React has the largest ecosystem. |
| Deployment | Docker Compose on a VPS | Handles first dozens of clients at ~€10-20/mo. Everything 12-factor so cloud/K8s later is config, not rewrite. |
| Multi-tenancy | Single DB, `tenant_id` column, EF Core global query filters | Painful to retrofit — built in from day one. |
| C#↔Python contract | Shared PostgreSQL + `shared/contracts/` docs; no direct calls; no queue in v1 | Jobs table covers dispatch; a queue can slot in later without redesign. |

## Architecture

Three deployable units + PostgreSQL in one monorepo, orchestrated by Docker Compose:

- **`backend/`** — ASP.NET Core 9 API. Owns auth, tenants, properties, serving recommendations.
  Owns the DB schema via EF Core migrations.
- **`dataplane/`** — Python. `scrapers/` (per-OTA modules), `ingest/` (events, INS stats,
  holidays, weather), `engine/` (rules pipeline), `scheduler/` (APScheduler + jobs-table polling).
- **`web/`** — React + TypeScript + Vite dashboard.

Table ownership (who may write) is documented in `shared/contracts/table-ownership.md`.
The API surface is specified in `shared/contracts/openapi.yaml`.
Job types/payloads are specified in `shared/contracts/jobs.md`.

## Pricing engine

A pipeline of independent rule modules, each a pure function contributing a signed
adjustment **with a reason**:

1. Seasonality baseline (city, month)
2. Event impact (events carry stored impact scores; FITS scores high)
3. Competitor position (your price vs scraped competitor rates)
4. Day-of-week pattern
5. Lead time

Output per property/room type/stay date: recommended price, expected revenue delta, and a
`factors` JSON rendered by the dashboard as plain language, e.g.:

> "FITS runs Jun 12–21. 8 of 10 competitors raised prices ~15%. Recommend 420 RON
> (from 350). Estimated +3,400 RON over the period."

Rules are pure functions and heavily unit-tested — a wrong price is the one unforgivable bug.

## Core data model

- `tenants`, `users`, `properties`, `room_types`
- `competitors` (property↔competitor mapping), `scraped_rates` (competitor, stay_date, price, captured_at), `scrape_runs` (status/freshness)
- `events` (city, name, dates, impact score), `demand_signals` (public stats time series)
- `recommendations` (property, room_type, stay_date, current_price, recommended_price, expected_impact, factors JSONB, status: pending/accepted/dismissed)
- `own_bookings` (future: hotel history — schema present, unused in v1)
- `jobs` (type, status, payload JSONB)

Recommendation `status` responses accumulate into future training data.

## Testing & failure handling

- Scrapers fail gracefully; every run recorded in `scrape_runs`; engine tolerates stale data;
  dashboard shows freshness.
- Scraper tests use saved HTML fixtures — never live sites in CI.
- xUnit (C#), pytest (Python), Vitest + React Testing Library (web); GitHub Actions CI runs all three.

## Agent development setup

- Root `CLAUDE.md`: architecture map, commands, definition of done, working routine
  (brainstorm → plan → TDD → code review before merge).
- Per-area `CLAUDE.md` in `backend/`, `dataplane/`, `web/`: stack conventions.
- `.claude/agents/`: `code-reviewer` (tenant isolation, contract drift, test coverage) and
  `implementer` routine.
- `docs/adr/`: architecture decision records.
