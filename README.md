# PricePilot

Dynamic pricing recommendations for hotels, guesthouses, and short-term rentals.
Scrapes competitor rates, ingests public demand signals (events, tourism statistics,
holidays, weather), and produces dated, explainable price recommendations with estimated
revenue impact — presented on a dashboard that owners can actually trust.

> *"FITS runs Jun 12–21. 8 of 10 competitors raised prices ~15%. Recommend 420 RON
> (from 350). Estimated +3,400 RON over the period."*

## Structure

| Path | What |
|---|---|
| `backend/` | ASP.NET Core 9 API — auth, tenants, properties, recommendations; owns the DB schema |
| `dataplane/` | Python — OTA scrapers, public-data ingestion, rules-based pricing engine, scheduler |
| `web/` | React + TypeScript dashboard |
| `shared/contracts/` | The C#↔Python↔web contracts (table ownership, jobs, factors JSON, OpenAPI) |
| `docs/` | Architecture, ADRs, design specs |

## Quick start

```bash
cp .env.example .env
docker compose up --build
# API:       http://localhost:8080  (health: /api/v1/health)
# Dashboard: http://localhost:5173
```

Local development without containers (except Postgres):

```bash
docker compose up -d db
cd backend  && dotnet run --project src/PricePilot.Api
cd dataplane && py -m venv .venv && .venv/Scripts/pip install -e .[dev] && py -m pricepilot.scheduler.main
cd web      && npm install && npm run dev
```

## Tests

```bash
cd backend   && dotnet test
cd dataplane && py -m pytest
cd web       && npm test
```

See `CLAUDE.md` for development rules and `docs/superpowers/specs/` for the design spec.
