# Recommendation Factors Contract

`recommendations.factors` (JSONB) carries the engine's reasoning. The dashboard renders it
as plain language; it must be complete enough to reconstruct the price arithmetic.

Produced by `dataplane/src/pricepilot/engine/`; consumed by `web/` via the API (served
verbatim). Backend treats it as opaque JSON.

## Shape

```json
{
  "engine_version": "2",
  "base_price": 350.00,
  "currency": "RON",
  "factors": [
    {
      "rule": "seasonality",
      "adjustment_pct": 5.0,
      "reason": "June is high season in Sibiu (avg occupancy 78%)."
    },
    {
      "rule": "event_impact",
      "adjustment_pct": 12.0,
      "reason": "FITS (impact 90/100) runs Jun 12-21.",
      "event_ids": ["<uuid>"]
    },
    {
      "rule": "competitor_position",
      "adjustment_pct": 3.0,
      "reason": "8 of 10 tracked competitors raised prices ~15% for these dates.",
      "sample_size": 10,
      "band_low": 380.00,
      "band_high": 455.00
    },
    {
      "rule": "day_of_week",
      "adjustment_pct": 0.0,
      "reason": "Tuesday: no weekday adjustment."
    },
    {
      "rule": "lead_time",
      "adjustment_pct": -2.0,
      "reason": "Stay is 6 days out; slight discount to capture late bookers."
    }
  ],
  "recommended_price": 413.00,
  "expected_impact": {
    "estimate": 3400.00,
    "currency": "RON",
    "period_start": "2026-06-12",
    "period_end": "2026-06-21",
    "method": "occupancy-weighted delta vs current price"
  },
  "data_freshness": {
    "scraped_rates_at": "2026-06-01T04:10:00Z",
    "events_at": "2026-05-30T02:00:00Z"
  }
}
```

Rules:
- Every factor has `rule`, `adjustment_pct`, `reason` (human-readable sentence, English in
  code; i18n happens in the web layer later).
- `recommended_price` = `base_price` × Π(1 + adjustment_pct/100), rounded per currency rules
  (RON: whole numbers, psychological rounding allowed but must round DOWN, never above the computed cap).
- Bump `engine_version` on any shape change and keep the dashboard renderer backward-compatible.
- `competitor_position.band_low` / `band_high` (v2+): the min/max of the competitor
  rates used for that stay date, present **iff** `sample_size > 0`. Consumers must
  tolerate their absence (v1 rows persist in the DB) — the dashboard hides the band
  then. These are server-computed truth: the web layer never derives money figures.

## Changelog

- `"2"` (2026-07-08): `competitor_position` factor gains `band_low`/`band_high`.
- `"1"` (2026-07-04): initial shape.
