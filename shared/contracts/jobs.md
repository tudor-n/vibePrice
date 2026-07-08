# Jobs Contract

The `jobs` table is the only dispatch mechanism between backend and dataplane in v1.
Backend inserts a row; the dataplane scheduler polls for `status = 'queued'`, claims it
(`status = 'running'`, sets `started_at`), executes, and finishes with
`status = 'succeeded' | 'failed'` plus `result` JSONB / `error` text.

The dataplane also enqueues its own recurring jobs internally (APScheduler); those appear
in this table too, for observability from the dashboard.

## Job types

| `type` | Payload | Effect |
|---|---|---|
| `scrape.competitor_rates` | `{"city": "sibiu", "property_id": "<uuid>\|null"}` | Scrape OTA rates for competitors of one property, or all properties in a city when `property_id` is null |
| `ingest.events` | `{"city": "sibiu"}` | Refresh events calendar for a city |
| `ingest.demand_signals` | `{"city": "sibiu"}` | Refresh public stats/holidays/weather signals |
| `engine.generate_recommendations` | `{"tenant_id": "<uuid>\|null", "property_id": "<uuid>\|null", "horizon_days": 90}` | Recompute recommendations; nulls mean "all" |

## Row shape

```
id uuid PK
type text
payload jsonb
status text: queued | running | succeeded | failed
result jsonb null
error text null
created_at / started_at / finished_at timestamptz
requested_by uuid null   -- user id when triggered from the dashboard
```

Rules:
- Claiming must be atomic (`UPDATE ... WHERE status='queued' ... RETURNING`) so multiple
  workers never double-claim.
- Jobs must be idempotent: re-running a succeeded job is always safe.
- New job types require updating this file first.

## Result shapes (job `result` JSONB)

`scrape.competitor_rates` (ADR 0004 — one city-search request per stay date per source):

```json
{
  "rates_written": 9,
  "cities": {
    "sibiu": {
      "rates_written": 9,
      "sources": {
        "booking": {
          "rates_written": 9, "dates_fetched": 3, "dates_failed": 0,
          "unmatched": ["Vila Fantoma"], "error": null
        },
        "airbnb": {"skipped": "not implemented"}
      }
    }
  }
}
```

or `{"rates_written": 0, "note": "no competitors configured for this scope"}` when the
scope resolves to nothing (no `scrape_runs` row is created then — an empty run must not
fake market freshness). Semantics:

- `scraped_rates` is **append-only history**: every job run appends a fresh observation
  set (uuid4 + `captured_at`); consumers read latest-per-(competitor, stay_date).
- One `scrape_runs` row per (city, source) attempt: `running` → `succeeded` when ≥1 rate
  was written (partial issues still recorded in `error`), `failed` when nothing was.
- Observations parsed in a currency other than the configured scrape currency are
  dropped and reported in `error` — money in the wrong currency never lands in the DB.
- `unmatched` lists competitors whose name never matched any listing on a fetched page
  (fix the competitor's name to match its OTA listing).
- The job itself fails only when every attempted source wrote nothing.

## Dashboard "Refresh data now"

The dashboard button enqueues three jobs in order: `scrape.competitor_rates` (property
scope) → `ingest.events` (city) → `engine.generate_recommendations` (property scope).
The single-worker FIFO poller executes them in enqueue order, so fresh rates and events
exist before the engine recomputes.
