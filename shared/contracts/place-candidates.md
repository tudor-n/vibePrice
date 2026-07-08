# Place candidates contract

`properties.place_candidates` and `competitors.place_candidates` (both `jsonb null`)
hold the top search results from a Google Places text/nearby search, so the owner-facing
correction UI can offer a picker without another API call.

## Shape

A JSON array (top 5) of:

```json
{
  "place_id": "…",
  "name": "…",
  "formatted_address": "…",
  "latitude": 45.798300,
  "longitude": 24.125600,
  "rating": 4.4,
  "rating_count": 1280
}
```

Coordinates and ratings are parsed to `Decimal`/`decimal` at the provider/adapter
boundary before serialization (money/decimal discipline extends to geo + ratings —
never a computed float). `formatted_address`, `rating`, and `rating_count` may be
`null` for a place with no reviews or no address on file.

Consumers (web, and the backend's `PropertyService.ToDto`) treat this array as opaque
display data — it is not used in any pricing computation.

## The `"__failed__"` sentinel

When a `resolve_place` job (`shared/contracts/jobs.md`) finds no matching place, the
dataplane writes the **literal string** `"__failed__"` into `place_candidates` (instead
of a JSON array) and leaves `place_resolved_at` null. This lets `place_status` be
derived from columns already present, with no dedicated status column:

- `place_resolved_at` set → `resolved`
- `place_resolved_at` null and `place_candidates == "__failed__"` → `failed`
- otherwise → `unresolved`

Any reader that deserializes `place_candidates` as JSON must special-case this sentinel
(treat it as "no candidates", not attempt `json.loads`/`JsonSerializer.Deserialize`) —
see `PropertyService.DeserializeCandidates` in the backend and the equivalent dataplane
helper (later task) for the reference implementation.
