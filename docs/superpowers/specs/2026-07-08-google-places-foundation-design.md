# Google Places Foundation — Design

**Date:** 2026-07-08
**Status:** Approved (design); implementation plan to follow.

## Context

End-state vision (owner's words): *"you can create an account and enter your
locations, they will also be tied to google locations and reviews … I want to
demo and see how the app plays out for an actual hotel … I want reviews of the
current location and of competitors to also affect the pricing (also
location/proximity to old town / tourist sights)."*

That vision decomposes into four subsystems that layer on each other:

1. **Google data foundation** — resolve properties + competitors to Google
   places; ingest geo coordinates + review score/count; seed proximity
   reference points. **← this spec.**
2. **Reviews pricing rule** — own vs. competitor reputation nudges price.
3. **Proximity pricing rule** — distance to old town / tourist sights nudges price.
4. **Self-service accounts** — sign-up + own-tenant creation (partly overlaps
   the on-hold wave-4 owner-self-service plan).

Subsystems 2 and 3 cannot exist without the data this spec ingests, so the
foundation ships first. Each later subsystem gets its own spec → plan → build
cycle.

This spec **supersedes the relevant parts of the on-hold wave-4 plan**
(`docs/superpowers/plans/2026-07-08-wave-4-owner-self-service.md`): the
owner-facing property-create surface is reshaped around Google name-resolution,
and **manual competitor creation is dropped entirely** in favour of automatic
discovery from the property's location. Room-type management and the
accept-loop price update from wave-4 are unaffected and remain deferred.

## Goals

- An owner enters **only their own property, by name + city**; the app resolves
  it to a Google place and enriches it with geo + rating + review count.
- **Competitors are auto-discovered** from the property's location — no manual
  competitor entry. Discovered competitor names feed the existing rate scraper
  unchanged.
- A simple, non-technical-friendly **correction flow** when the auto-pick is wrong.
- Curated, seeded **points of interest** per city, exposed for the (later)
  proximity rule.
- The whole thing is **demoable off real data captured once** and cached in the
  DB, while tests never touch live Google.

## Non-goals (deferred to later specs)

- The reviews pricing rule and the proximity pricing rule (this slice ingests +
  stores + displays the data only; the engine is untouched).
- Self-service account sign-up.
- Live Google adapter verification against a billing-enabled key (human-in-the-loop,
  like the Booking scraper live-verify — documented, not executed here).
- Review **text** / sentiment. Only the aggregate rating + review count are stored.

## Architecture

Three new capabilities, all riding the existing PostgreSQL + `jobs` seam. No new
cross-runtime calls: the backend only writes core rows and enqueues jobs; the
dataplane owns **every** Google call.

```
Owner types "Hotel X" + city                     [web]
      │  POST /properties {name, city}
      ▼
Backend creates property row (place unresolved)   [backend]
      │  enqueues job: resolve_place {property_id}
      ▼
Dataplane worker claims job                        [dataplane]
   PlacesProvider.text_search("Hotel X", city=…)
     → GoogleAdapter (live, env-keyed) | FixtureAdapter (tests/demo)
   → writes property.place_id / latitude / longitude / rating /
            rating_count / place_resolved_at + place_candidates (top N)
   → chain-enqueues job: discover_competitors {property_id}
      ▼
Dataplane discover_competitors                     [dataplane]
   PlacesProvider.nearby(lat, lng, kind="lodging", radius_m=…)
   → upserts competitor rows (name, place_id, geo, rating, rating_count,
     discovered_at, discovery_source) — excludes the property's own place
     and any tombstoned (excluded) place_id
      ▼
Existing Booking scraper matches competitor NAMES → scraped_rates  (unchanged)
Existing engine runs → recommendations                              (rules unchanged)
```

**Correction path:** the owner sees the resolved place; if it's wrong, a picker
shows the already-fetched `place_candidates` (no API call) → owner selects one →
backend copies that candidate's fields over. "Search by a different name"
re-enqueues `resolve_place` with a new query.

**POIs** are seeded, city-scoped reference points. Proximity math lands with the
rule in a later slice; this slice seeds them and exposes a read endpoint.

### Why this shape

- **Dataplane owns external ingestion** (hard rule 5): all Google I/O is behind
  a provider seam in the dataplane, dispatched via the jobs table.
- **Auto-discovery is architecturally free**: the Booking scraper already
  matches competitors by *name* (`significant_tokens`, `matching.py`), not by
  `source_url`. A Google display name is a valid matching key, so discovered
  competitors need no OTA URL.
- **Tenant isolation is automatic**: place data lives as columns on
  `properties` / `competitors`, which already carry `tenant_id` and EF global
  query filters.

## Data model

All schema changes are backend-owned: EF Core migration + SQLAlchemy mapping in
`dataplane/db/tables.py` + `shared/contracts/table-ownership.md`, **same
commit**. Coordinates are `numeric(9,6)` (≈0.1 m; no floats, per the
money/decimal discipline applied to all coordinates). Ratings are nullable
(a new or unrated place legitimately has none).

**`properties`** — add:

| Column | Type | Notes |
|---|---|---|
| `place_id` | `text null` | Google place id |
| `latitude` | `numeric(9,6) null` | |
| `longitude` | `numeric(9,6) null` | |
| `rating` | `numeric(2,1) null` | 0.0–5.0 |
| `rating_count` | `int null` | |
| `place_resolved_at` | `timestamptz null` | null = unresolved |
| `place_candidates` | `jsonb null` | top 5 search results for the correction picker (owner-facing, transient) |

**`competitors`** — add the same seven place columns, plus:

| Column | Type | Notes |
|---|---|---|
| `discovered_at` | `timestamptz null` | when auto-discovery created the row |
| `discovery_source` | `text null` | e.g. `"google_nearby"`; null = manual/legacy |
| `excluded_at` | `timestamptz null` | tombstone: owner-untracked; skipped by discovery + scraper + reads |

`competitors.source_url` becomes **nullable** (auto-discovered competitors have
no OTA URL; the scraper matches by name).

**New `points_of_interest`** (city-scoped, like `events` — NOT tenant-scoped;
backend-owned schema, backend-written seed):

| Column | Type |
|---|---|
| `id` | `uuid pk` |
| `city` | `text` |
| `name` | `text` |
| `latitude` | `numeric(9,6)` |
| `longitude` | `numeric(9,6)` |
| `weight` | `int` (0–100 importance) |
| `created_at` | `timestamptz` |

### `place_candidates` shape (new contract note)

A JSON array (top 5) of:

```json
{ "place_id": "…", "name": "…", "formatted_address": "…",
  "latitude": 45.798300, "longitude": 24.125600,
  "rating": 4.4, "rating_count": 1280 }
```

Documented in `shared/contracts/` alongside the existing factor/job contracts.
Consumers (web) treat it as opaque display data; money-free, so no decimal
boundary concerns beyond serialization.

## Provider seam (dataplane)

New package `dataplane/src/pricepilot/places/`.

```python
class PlaceCandidate:        # dataclass
    place_id: str
    name: str
    formatted_address: str | None
    latitude: Decimal
    longitude: Decimal
    rating: Decimal | None
    rating_count: int | None

class PlacesProvider(Protocol):
    def text_search(self, query: str, *, city: str) -> list[PlaceCandidate]: ...
    def details(self, place_id: str) -> PlaceCandidate: ...
    def nearby(self, lat: Decimal, lng: Decimal, *,
               radius_m: int, kind: str = "lodging") -> list[PlaceCandidate]: ...
```

- **`GoogleAdapter`** — live; keyed by `GOOGLE_PLACES_API_KEY`. All HTTP through
  a polite client mirroring `scrapers/client.py` (timeout, bounded retries).
  Never invoked in tests.
- **`FixtureAdapter`** — replays saved JSON from `tests/fixtures/places/`. Used
  by tests and by the demo (`PLACES_PROVIDER=fixture`).
- Provider chosen by config, registered like the `SCRAPERS` registry.
- A `capture` CLI (mirroring `scrapers/capture`) records one live response as a
  fixture candidate for the demo — human-in-the-loop, run once with a real key.

**Money/decimal discipline:** coordinates and ratings are parsed straight to
`Decimal` at the adapter boundary; floats appear only in the serialized JSON
payload, never in computation (same rule as the engine serializer).

## Jobs

Contract `shared/contracts/jobs.md` updated first, then handlers in
`scheduler/jobs.py` `HANDLERS`. Both idempotent (re-running is safe).

- **`resolve_place {property_id}`** — `text_search(name, city)`, auto-pick the
  top match, write the property's place fields + `place_candidates`, set
  `place_resolved_at`. On no result: leave unresolved, record the failure so the
  UI can show a `failed` status. On success, chain-enqueue `discover_competitors`.
- **`discover_competitors {property_id}`** — `nearby(lat, lng, kind="lodging",
  radius_m=…)`; upsert competitor rows keyed by a deterministic `uuid5` of the
  `place_id` (idempotent); **exclude** the property's own `place_id` and any row
  with `excluded_at` set (tombstone); cap at `COMPETITOR_DISCOVERY_MAX`, logging
  the dropped overflow (no silent truncation). Requires the property to be
  resolved (has lat/lng); otherwise no-op with a logged reason.

## Backend endpoints & contracts

Every lookup goes through the tenant-filtered context; foreign ids → **404, not
403**. `openapi.yaml` moves in the same commit as each endpoint.

| Method / path | Result | Notes |
|---|---|---|
| `POST /properties` `{name, city}` | 201 + Property | creates row, enqueues `resolve_place` |
| `GET /properties` | 200 + `[Property]` | now includes place fields, `place_candidates`, `place_status` (`unresolved`/`resolved`/`failed`) |
| `POST /properties/{id}/resolve-place` `{query?}` | 202 | re-enqueues `resolve_place` ("search again"); 404 on foreign id |
| `PATCH /properties/{id}/place` `{place_id}` | 200 + Property | owner picks a candidate; **400** if `place_id` not in stored `place_candidates`; copies its fields |
| `GET /properties/{id}/competitors` | 200 + `[Competitor]` | discovered list w/ rating/geo/distance; excludes tombstoned |
| `DELETE /competitors/{id}` | 204 | soft-delete: sets `excluded_at` (tombstone). **No manual create endpoint.** |
| `GET /points-of-interest?city=` | 200 + `[Poi]` | read-only |

`place_status` is derived: `place_resolved_at is null && no failure` →
`unresolved`; resolved timestamp present → `resolved`; last `resolve_place` job
failed with no place → `failed`.

## Web UX (simple, for non-technical owners)

Watercolor tokens only; react-query hooks; `types.ts` mirrors `openapi.yaml`.
a11y: labels, ≥44px targets, visible focus, explicit loading/resolving/failed/
empty states.

- **Add your property** (Settings/onboarding): one primary action — name + city,
  nothing else. Card then shows *resolving → resolved* (name, address, ★rating,
  review count, small map pin) or *failed* with a retry.
- **Correction control** on the property card: "Not the right place?" → radio
  list of stashed candidates (name + address + rating), plus a "Search by a
  different name" box. One tap fixes it (`PATCH …/place` or `POST …/resolve-place`).
- **Competitors page:** read-only *discovered* list (name, ★rating, review
  count, distance) each with **Untrack** (confirm dialog explaining it stays
  removed). No add form.

## POI seed & demo

- **POI seed** (backend, idempotent `uuid5` from city+name) — Sibiu: Piața Mare
  (w100), Piața Mică (w90), Podul Minciunilor (w70), Muzeul Brukenthal (w80),
  old-town centroid (w100).
- **Demo:** capture one real Sibiu hotel's Google data once via the `capture`
  CLI (real key, human-in-the-loop) → saved fixture; `PLACES_PROVIDER=fixture`
  replays it so the demo and tests are deterministic and never bill Google.
  `docs/demo.md` gains the enter-property → resolve → discover-competitors
  walkthrough. Even before the pricing rules land, the demo shows a real hotel
  with real geo + rating and its real nearby competitors with their ratings.

## Configuration (12-factor)

`.env.example` documents every variable:

| Variable | Default | Purpose |
|---|---|---|
| `PLACES_PROVIDER` | `fixture` | `google` \| `fixture`; default never bills live |
| `GOOGLE_PLACES_API_KEY` | — | required when `PLACES_PROVIDER=google`; never committed |
| `COMPETITOR_DISCOVERY_RADIUS_M` | `1500` | nearby search radius |
| `COMPETITOR_DISCOVERY_MAX` | `15` | cap on discovered competitors per property |

## Testing (TDD)

- **Dataplane:** provider fixtures in `tests/fixtures/places/`; pure unit tests
  for `text_search` parsing, `nearby` dedup + property-exclusion + tombstone-skip
  + `COMPETITOR_DISCOVERY_MAX` overflow logging, `uuid5` idempotency, and the two
  job handlers (with a fake provider). Schema-sync test stays green. Never a live
  Google call.
- **Backend:** WebApplicationFactory + SQLite tests per endpoint — create enqueues
  `resolve_place`; tenant 404s; candidate-pick 400 when `place_id` unknown;
  untrack sets `excluded_at`; POI read.
- **Web:** RTL tests for add / resolving / resolved / failed / correct / untrack /
  error states with mocked fetch.
- No new frontend deps; backend `dotnet build` warnings-as-errors + `dotnet test`;
  dataplane `pytest` + `ruff`; web `npm test`/typecheck/build all green.

## Definition of done

- [ ] Tests written and passing across all touched areas.
- [ ] Contracts updated in the same commits: `table-ownership.md` (three tables),
      `jobs.md` (two job types), `openapi.yaml` (new/changed endpoints),
      new `place-candidates` note.
- [ ] Schema change = EF migration **and** SQLAlchemy mapping together; dev DB
      migrated; schema-sync green.
- [ ] Tenant isolation preserved on every new query; foreign ids → 404.
- [ ] `.env.example` documents the four new variables; `PLACES_PROVIDER=fixture`
      default means no live call without opt-in.
- [ ] Code-reviewer agent ran on the diff; findings addressed.
- [ ] `docs/demo.md` walkthrough added; roadmap + memory updated.

## Open items for later specs

- Reviews pricing rule (own vs. competitor reputation → `adjustment_pct`).
- Proximity pricing rule (property ↔ weighted POIs → `adjustment_pct`).
- Self-service account sign-up.
- Live Google adapter verification against a billing-enabled key.
