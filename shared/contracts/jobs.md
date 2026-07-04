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
