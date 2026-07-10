# Reliable competitor pricing via Booking listing links

**Date:** 2026-07-10
**Status:** Approved (design)
**Area:** `dataplane/` (scrapers + scheduler). No backend or web changes. No schema change.

## Context & problem

Switching competitor discovery to live Google Places (2026-07-09) exposed a
pricing failure. Discovery now produces real competitors (name, `place_id`,
coordinates), but the price scraper attributes Booking listings to competitors
by **fuzzy name-token matching** on a single city-search page
(`scrapers/matching.py`, ADR 0004). Google's names do not match Booking's, and
many discovered hotels aren't on the first city-search page, so the scrape
writes **zero rates** for real competitors and the job fails with
`unmatched competitors: ...`.

Observed: a property with 12 discovered competitors had **0 `scraped_rates`**;
the only rates in the DB belonged to 4 hand-seeded demo competitors. With no
competitor rates, the engine's `competitor_position` factor has `sample_size 0`
and contributes nothing — recommendations lose their market signal.

### Root cause

The **name is the wrong join key.** It is produced by one system (Google) and
must match text rendered by another (Booking), re-guessed on every run. Fuzzy
matching also risks the opposite failure — silently attributing the *wrong*
hotel's price, which is worse than no price ("prices are the product").

## Goals

1. Every competitor that exists on Booking gets a **reliable, exact** nightly price.
2. A competitor genuinely **absent** from Booking produces an **honest gap**
   (no rate, reported), never a wrong price.
3. Stay within the polite, city-search-shaped scraping posture (ADR 0004);
   no request explosion.
4. Fully automatic and backend-only — no owner involvement.
5. No schema migration; reuse the existing `competitors.source_url` column.

## Non-goals (explicitly deferred)

- Removing the owner-facing competitor UI / setup step (separate thread).
- Naming individual competitors in the engine's `factors` explanation
  (separate thread; `recommendation-factors.md` shape is **unchanged** here).
- Owner-facing "correct this link" UI (human-in-the-loop). The design *enables*
  it later by storing an inspectable per-competitor link, but builds no UI.
- A Booking hotel-*page* parser, coordinate-based matching, and any paid rate
  API. Noted in "Future levers".

## Approach (A): fuzzy once, exact forever

Move the fragile "which Booking listing is this hotel?" decision **out of the
recurring path** and make it a **one-time, inspectable** step; make the nightly
scrape **exact** by keying on Booking's own stable identity.

```
Discovery (Google)         one-time link (Booking)        nightly price scrape
─────────────────          ───────────────────────        ────────────────────
competitor row      ──►    search Booking "{name},{city}"   city-search per date
 name, place_id,           reuse match_listings to pick     parse cards (+slug)
 lat/lng, source_url=∅     the best card ──► store its      match competitor↔card
                           Booking URL in source_url        by SLUG (exact)
                                                            write scraped_rates
```

The recurring match key becomes the **Booking slug** (stable hotel identifier
parsed from the listing URL, e.g. `/hotel/ro/continental-forum-sibiu.html` →
`ro/continental-forum-sibiu`), not the display name. Booking can rename a hotel
and the link still resolves.

## Components

### 1. Booking listing identity (`scrapers/booking.py`, `scrapers/base.py`)

- `ListingRate` gains **`url: str | None`** — the card's hotel URL, absolute.
- `parse_listings` extracts the title-link `href` (`a[data-testid="title-link"]`,
  with fallbacks) per card and resolves it against `https://www.booking.com`.
  A card with no readable link keeps `url=None` (still usable for name-fallback).
- New pure helper **`booking_slug(url: str) -> str | None`**: extracts the
  `/hotel/<cc>/<slug>` path, lowercased, query/fragment stripped; `None` when the
  URL isn't a recognisable Booking hotel URL. This is the identity key on both
  sides (competitor `source_url` and listing `url`).

Pure and fixture-tested; no network. Fixtures updated to include hotel links.

### 2. Link resolver + `link_competitor_sources` job (`scrapers/linker.py` + `scheduler/jobs.py`)

- Pure `resolve_competitor_link(cards, competitor, city) -> str | None`:
  reuses the **existing `match_listings`** against a **name-scoped** Booking
  search (high recall for one specific hotel), returning the matched card's
  canonical URL, or `None` when no confident match. Reusing `match_listings`
  keeps link-time and scrape-time matching semantics identical.
- Handler `handle_link_competitor_sources(session, payload)`:
  - Payload `{"property_id": "<uuid>|null"}` (null = all properties — a sweep).
  - For each in-scope competitor with `source_url IS NULL` and `excluded_at IS
    NULL`: plan a name-scoped Booking search (`ss = "{name}, {city}"`), fetch via
    `PoliteClient`, parse cards, call `resolve_competitor_link`, and on success
    write `source_url` (single-column update; dataplane already owns competitor
    writes). No match → leave `NULL` (retried by the next sweep), tally as
    `unlinked`.
  - **Idempotent**: only fills `NULL` links, never overwrites an existing/
    corrected one. Re-running is safe.
  - Politeness/blocking handled by `PoliteClient`; a block aborts the remaining
    competitors for the run (like the scraper), reported in `result`.
- **Chaining**: `discover_competitors` enqueues `link_competitor_sources`
  (property scope) after upserting rows — mirroring how `resolve_place` chains
  `discover_competitors`. A nightly sweep (APScheduler, null scope, just before
  the scrape) links anything still unlinked, including competitors discovered
  before this feature.

### 3. Slug-based matching in the orchestrator (`scrapers/matching.py`, `orchestrator.py`)

- `CompetitorRef` gains **`source_url: str | None`**; `competitors_by_city` adds
  `Competitor.source_url` to its `SELECT` and passes it through (today it selects
  only `id, name, city`).
- `match_listings` becomes two-tier, per competitor:
  1. **Linked** (`source_url` set): match to the listing whose `booking_slug(url)`
     equals `booking_slug(source_url)`. Exact; at most one; no name involved.
  2. **Unlinked** (`source_url` NULL): fall back to today's significant-token
     name matching. Preserves behaviour for not-yet-linked rows and demo data.
- Slug match is deterministic and unambiguous, so it always wins over any
  name-fallback candidate for the same competitor.

### 4. Bounded, adaptive coverage (`orchestrator.py`, `scrapers/booking.py`)

The city-search page shows a limited set; a linked competitor may be on a later
page. To close that gap while staying polite:

- `build_search_url` gains an **`offset`** parameter (Booking paginates in
  multiples of 25).
- The orchestrator fetches pages for a stay date **only until every in-scope
  competitor is matched or `scrape_max_pages` is reached** (new config, default
  **2**). In the common case (all competitors on page 1) this is exactly one
  request per date — ADR 0004 unchanged. It escalates only when needed, bounded
  by config.
- Remaining unmatched competitors after the last page are reported in
  `unmatched` (honest gap), as today.

## Data model & contracts

- **No schema migration.** `competitors.source_url` already exists (nullable,
  dataplane-written per `table-ownership.md`). The slug is derived, not stored.
- **`shared/contracts/jobs.md`**: add the `link_competitor_sources` type
  (payload + result shape) and note the extended setup chain
  (`resolve_place → discover_competitors → link_competitor_sources`). Updated in
  the same PR, before the handler (repo rule).
- **`shared/contracts/table-ownership.md`**: refine the `competitors.source_url`
  note — dataplane now writes it via `link_competitor_sources` (was "until the
  scraper matches them by name").
- **`recommendation-factors.md`**: unchanged (no factor shape change).
- `db/tables.py`: `Competitor.source_url` is already mapped; no DDL.

### Job result shapes (jobs.md)

```json
// link_competitor_sources
{"property_id": "…|null", "linked": 9, "unlinked": 3, "blocked": false}
```
`scrape.competitor_rates` result shape is unchanged; `unmatched` now trends
toward zero as links populate.

## Data flow

```
POST /properties/{id}/resolve-place
  └─ resolve_place ─► discover_competitors ─► link_competitor_sources
                                                 └─ writes competitor.source_url

nightly (APScheduler):  link sweep (null scope) ─► scrape.competitor_rates
Dashboard "Check for new prices":  scrape ─► ingest.events ─► engine.generate
                                     └─ slug-exact match ─► scraped_rates ─► engine
```

## Error handling & edge cases

- **Mislink**: constrained by reusing the conservative `match_listings` (subset/
  exact only) against a name-scoped search. A wrong link is a single stored
  value, inspectable and (future) correctable — not a per-run silent error.
- **No confident match**: `source_url` stays `NULL`; competitor uses name-
  fallback and is retried by the next sweep. Reported as `unlinked`.
- **Absent from Booking**: no rate; surfaced in `unmatched`. Correct outcome.
- **Booking blocks**: `PoliteClient` handling; link/scrape runs abort remaining
  work and report `blocked` — never fabricate data.
- **Currency**: unchanged — non-target-currency observations are dropped and
  reported (money never lands in the wrong currency).
- **Idempotency**: linker only fills `NULL`; scrape stays append-only history;
  chaining re-enqueues are safe.
- **Tombstones**: `excluded_at` competitors are skipped by the linker and by
  discovery, as today.
- **Owner edits**: if a `source_url` was set by anyone, the linker leaves it
  (enables future manual correction without being clobbered).

## Config (`config.py`, `.env.example`)

- `scrape_max_pages: int = 2` — max city-search pages per stay date (adaptive:
  stops early when all competitors matched). `1` restores strict ADR-0004.
- `competitor_link_max_results: int = 10` — cards to consider per link search.

## Testing strategy

Unit (pure, fixtures only — never live sites):
- `booking_slug`: hotel URLs (with query/locale), non-hotel URLs, `None`.
- `parse_listings`: extracts `url`; cards missing links → `url=None`.
- `resolve_competitor_link`: exact-name match, token-subset match, no-match →
  `None`, ambiguous → `None`.
- `match_listings`: linked competitor matches by slug even when names differ;
  unlinked falls back to name; slug beats name; per-competitor at-most-one.
- Orchestrator pagination: stops when all matched (1 page); escalates to
  `scrape_max_pages`; residual `unmatched` reported.

Integration (`tests/integration/`, DB-backed, auto-skip when DB down):
- `link_competitor_sources` writes `source_url` for a matchable competitor,
  leaves an unmatchable one `NULL`, is idempotent, honours `excluded_at`.
- End-to-end: discover → link → scrape yields `scraped_rates` for linked
  competitors keyed by slug.

New Booking fixtures: a name-scoped search result (link step) and a city-search
page carrying hotel links (slug matching). Existing fixtures gain title links.

## Rollout / backfill

1. Ship the linker + slug matching + pagination behind the existing scrape flow.
2. One-off: enqueue `link_competitor_sources` with null scope (or let the nightly
   sweep run) to backfill links for already-discovered competitors.
3. Next scrape attaches real prices; `competitor_position` regains its signal.

No migration, no backend/web deploy coupling.

## Future levers (out of scope here)

- Owner "correct this link" UI (human-in-the-loop) — storage already supports it.
- Coordinate/address tiebreak in the linker (needs card coords or a hotel-page
  fetch).
- Direct hotel-page price fetch for stragglers absent from all searched pages.
- Swap Booking for a paid rate API behind the same seam (per-source isolation).
