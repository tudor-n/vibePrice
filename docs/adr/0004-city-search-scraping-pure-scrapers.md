# ADR 0004: City-search scraping with pure scrapers and one polite HTTP client

**Status:** Accepted · 2026-07-08

## Context

The scraper scaffold split each OTA module into `parse` (pure) and `fetch` (I/O), with
`fetch(source_url, stay_dates)` implying one request stream per competitor property
page. Implementing Booking.com for real forces the strategy choice: per-competitor
property pages are the most anti-bot-hardened surface, cost requests × competitors ×
dates, and would need a `competitors.source` column to route dispatch. Tests must never
touch live sites (repo hard rule), and anti-bot iteration needs a human in the loop —
so the testable surface must be maximal and the I/O surface minimal.

## Decision

1. **City-search strategy**: one Booking.com search-results request per stay date
   returns every listed property in the city with its cheapest nightly rate. Result
   cards are matched to competitors by normalized significant-token name matching.
   One nightly pass ≈ `SCRAPE_DAYS_AHEAD` (90) requests per city, covering all
   competitors of all properties there. No schema change.
2. **Scrapers are fully pure**: the scraper interface is `plan_request(city,
   stay_date) -> PlannedRequest` + `parse_listings(html) -> [ListingRate]`. All
   network I/O lives in a single `PoliteClient` (UA/proxy/timeouts from Settings,
   delay + jitter between requests, bounded retries on transient failures, and
   403/429/challenge detection raising `ScraperBlockedError`, never retried).
   The orchestrator composes client + scraper + matcher and owns persistence
   (`scraped_rates` append-only observations, `scrape_runs` bookkeeping).
3. `scraped_rates` stays **append-only history** (the engine reads latest per
   competitor/stay date); rate evolution over lead time is future training data.

## Consequences

- (+) Parsers, matchers, and the orchestrator are unit-testable with fixtures/fakes;
  the only untestable-in-CI code is the thin client.
- (+) Request volume is independent of competitor count; politeness is enforced in one
  place; a paid rate API later replaces the scraper module behind the same orchestrator.
- (−) Name matching can miss a competitor (misspelled/renamed listings); unmatched
  competitors are surfaced per run in the job result rather than silently dropped.
- (−) Search pages show the *cheapest* room's rate, not per-room-type rates — accepted
  for v1 (competitor position is a band, not a per-room comparison).
- Airbnb search is client-rendered; it stays registered-but-unimplemented until a
  browser-based fetcher (or API) is added behind the same pure interface.

## Amendment — 2026-07-10

`scrape_max_pages` (config, default 2) permits bounded adaptive escalation beyond the
original one-request-per-stay-date baseline: per date, the orchestrator fetches
additional city-search result pages only while at least one in-scope competitor is
still unmatched, stopping early the moment every competitor is matched (so the common
case stays one request). `scrape_max_pages=1` reproduces the original strict
one-request-per-date behavior exactly. This improves competitor coverage for cities
where a single search page doesn't surface every listing. See
`docs/superpowers/specs/2026-07-10-competitor-booking-linking-design.md` for the design
this shipped under; the core decision above (city-search over per-property pages, pure
scrapers, one polite client) is unchanged.
