# Architecture

See the approved spec in `superpowers/specs/2026-07-04-pricepilot-design.md` for scope and
rationale. This file describes the runtime shape.

## Data flow

```
                    ┌─────────────────────────────────────────────┐
                    │                dataplane (Python)           │
  OTA sites ──────► │ scrapers/  ─┐                               │
  Event calendars ► │ ingest/    ─┼─► PostgreSQL ◄─ engine/       │
  INS / weather ──► │             │   (scraped_rates, events,     │
                    │ scheduler/ ─┘    demand_signals,            │
                    └──────────────    recommendations) ──────────┘
                                          ▲        ▲
                              jobs table  │        │ reads
                                          │        │
                    ┌─────────────────────┴────────┴──────────────┐
                    │           backend (ASP.NET Core)            │
                    │  auth · tenants · properties · API          │
                    └─────────────────────▲────────────────────────┘
                                          │ REST (openapi.yaml)
                    ┌─────────────────────┴────────────────────────┐
                    │              web (React + TS)                │
                    └───────────────────────────────────────────────┘
```

- The **dataplane scheduler** runs recurring pipelines (scrape → ingest → engine) and polls
  the `jobs` table for on-demand runs triggered from the dashboard.
- The **engine** reads scraped rates + demand signals + room type base prices, writes
  `recommendations` rows with a complete `factors` reasoning payload.
- The **backend** serves recommendations to the dashboard and records owner accept/dismiss.
- **No direct calls** between backend and dataplane. Ever.

## Deployment

Docker Compose on a single VPS: `db` (Postgres 17), `api` (:8080), `dataplane` (no ports),
`web` (nginx serving the Vite build, :5173→80). Reverse proxy / TLS (Caddy or nginx) sits in
front in production. Every service is stateless except `db`; scaling later means moving `db`
to managed Postgres and running more `api`/`dataplane` replicas — the jobs table's atomic
claim already supports multiple workers.

## Future seams (built, not implemented)

- `PricePilot.Connectors`: `INotificationConnector` (email/WhatsApp), `IChannelConnector`
  (Booking/Airbnb price push). DI-registered no-op stubs.
- `own_bookings` table for hotels' historical bookings.
- Engine `forecast/` package: future ML demand index feeding the rules pipeline as one more input.
- Queue: if jobs-table polling ever limits us, replace the polling loop; contracts unchanged.
