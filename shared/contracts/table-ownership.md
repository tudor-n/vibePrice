# Table Ownership Contract

The C# backend and the Python dataplane never call each other directly.
They share one PostgreSQL database. This document is the contract for who may
**write** each table. Everyone may read everything (within tenant scope).

**Schema is owned by the backend**: all tables are created/altered exclusively via
EF Core migrations in `backend/src/PricePilot.Infrastructure`. The Python side maps
existing tables (SQLAlchemy models in `dataplane/src/pricepilot/db/tables.py`) and must
never emit DDL.

Any change to a shared table requires updating BOTH sides in the same PR:
EF Core entity + migration, and the SQLAlchemy model.

| Table | Written by | Notes |
|---|---|---|
| `tenants` | backend | subscription fields included; no billing integration in v1 |
| `users` | backend | `email` is stored **normalized** (trimmed + lowercased) on every write path and has a plain **unique index** (`ix_users_email`) — uniqueness is global, not per tenant, because login looks users up by email before any tenant is resolved |
| `properties` | backend | has `tenant_id`; Google Places fields: `place_id`, `latitude`/`longitude` (`numeric(9,6)`), `rating` (`numeric(2,1)`), `rating_count`, `place_resolved_at`, `place_candidates` (JSONB array of top-5 search candidates for the correction picker, opaque to the backend) |
| `room_types` | backend | has `tenant_id`; holds `base_price` and `current_price` |
| `competitors` | backend | property↔competitor mapping; has `tenant_id`; `source_url` is now **nullable** — auto-discovered competitors have none until the scraper matches them by name; same Google Places fields as `properties`, plus `discovered_at`/`discovery_source` (auto-discovery provenance) and `excluded_at` (untrack tombstone) |
| `scraped_rates` | dataplane | competitor_id, stay_date, price, currency, captured_at |
| `scrape_runs` | dataplane | one row per scraper execution: source, status, started/finished, error |
| `events` | dataplane | city-scoped, not tenant-scoped; name, start/end, impact_score 0-100 |
| `points_of_interest` | backend | city-scoped (NOT tenant-scoped); seeded landmarks with lat/lng + weight for the proximity rule |
| `demand_signals` | dataplane | city-scoped public stats time series (INS, weather, holidays) |
| `recommendations` | **both** | dataplane INSERTs new rows; backend UPDATEs `status` only (pending → accepted/dismissed). Partial unique index: at most one **pending** row per (room_type_id, stay_date) — concurrent engine runs fail loudly instead of duplicating |
| `own_bookings` | dataplane | future ingestion of hotel booking history; unused in v1 |
| `jobs` | **both** | backend INSERTs (dashboard "refresh now"); dataplane claims rows and UPDATEs `status`/`result` |

## Conventions

- All identifiers snake_case. Primary keys `id UUID`. Timestamps `timestamptz`, UTC, named `*_at`.
- Every tenant-owned table has `tenant_id UUID NOT NULL` + index. City-scoped shared data
  (`events`, `demand_signals`, `scraped_rates`, `scrape_runs`, `points_of_interest`) is NOT tenant-scoped.
- Money: `numeric(10,2)` + `currency char(3)` (ISO 4217). Never floats.
- `recommendations.factors` is JSONB; its shape is defined in `recommendation-factors.md`.
- `jobs` payloads/types are defined in `jobs.md`.
