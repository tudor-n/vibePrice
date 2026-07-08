# Wave 3 — Real Market Data & Watercolor UI

**Date:** 2026-07-08
**Status:** Approved (autonomous session; user granted free reign with "data scraping +
business-usable MVP" as the stated priority and the watercolor design handoff to apply)
**Depends on:** `2026-07-04-pricepilot-design.md` (approved product design)

## Goal

Make PricePilot usable by a real business: recommendations driven by **real competitor
rates** (not demo-seeded ones), **real public demand signals**, and a dashboard that
looks like a product owners trust — the "watercolor storybook" design handoff
(`Historical town sketch design/design_handoff_pricepilot_watercolor/`).

Three parts, in priority order. Each part lands with tests, code review, and a green
suite before the next starts.

---

## Part A — Real scraping pipeline

### Problem

`handle_scrape_competitor_rates` is a stub; `BookingScraper.fetch` raises
`NotImplementedError`; the parser targets a synthetic fixture. Meanwhile the dashboard
"Refresh data now" button POSTs job type `refresh_all`, which the backend rejects
(`JobTypes.IsValid` → 400) — the button has never worked.

### Approaches considered

1. **Per-competitor property pages** (`competitors.source_url`, one request per
   competitor per stay date). Rejected: N×dates requests, the `hprt` room-table markup
   is the most anti-bot-hardened surface, and it needs a `source` column migration.
2. **City search pages** — one request per stay date returns *every* hotel in the city
   with its cheapest nightly rate; match result cards to competitors by name.
   **Chosen**: 90 requests/night covers all competitors of all properties in a city,
   the search page is server-rendered, and no schema change is needed.
3. **Paid rate API** (e.g. a rate shopper). Rejected for now (cost from day zero);
   the design keeps scrapers swappable for exactly this later.

### Architecture (ADR 0004)

Scrapers become **fully pure**; all network I/O concentrates in one place:

```
scrapers/base.py        SearchScraper interface (pure):
                          plan_request(city, stay_date) -> PlannedRequest(url, headers)
                          parse_listings(html) -> list[ListingRate(name, price, currency)]
scrapers/booking.py     BookingScraper: real search-results markup (data-testid cards)
scrapers/client.py      PoliteClient (the ONLY I/O): httpx, UA/proxy from Settings,
                          per-request delay + jitter, timeout, bounded retries with
                          backoff on transient errors (timeouts, 5xx), and blocked
                          detection: 403/429 or challenge markup -> ScraperBlockedError
                          (never retried — back off, fail the source loudly)
scrapers/matching.py    normalize + match listings to competitors (pure)
scrapers/orchestrator.py run_scrape(session, client, city, competitors, stay_dates):
                          per source: scrape_runs row (running -> succeeded/failed),
                          fetch+parse per date, match, INSERT scraped_rates
scrapers/capture.py     CLI: fetch one search page with the same client, save to
                          tests/fixtures/ (human-in-the-loop re-capture flow)
scrapers/run.py         CLI: --city/--days/--dry-run — live test without the scheduler
```

This *replaces* the old `BaseScraper.fetch/parse` interface (`fetch` was never
implemented; nothing depends on it). Airbnb stays a registered-but-not-implemented
source: `plan_request` raises `NotImplementedError`, the orchestrator skips sources
that raise it at planning time and reports them in the job result.

Tests never touch the network (repo hard rule): the client is injected, tests use a
fake client returning fixture HTML; unit tests cover parser/matcher/URL-builder purely.

### Matching (the risky part, pinned)

- Normalize: casefold → NFKD-strip diacritics → drop punctuation → collapse whitespace.
- Significant tokens: drop generic stopwords (`hotel, hostel, pension, pensiune,
  pensiunea, guesthouse, apartments, aparthotel, boutique, by, the, la`) and the city name.
- Match when one side's significant-token set is a subset of the other's (so
  competitor "Hotel Ramada Sibiu" matches listing "Ramada by Wyndham Sibiu").
- Preference order per competitor: exact normalized equality > subset with the largest
  token overlap > alphabetical (deterministic). Competitors with zero matches are
  listed in the job result (`unmatched`) so the owner can fix names later.

### Persistence & run semantics

- `scraped_rates`: **append-only observations** (uuid4 + `captured_at=now`). History is
  intentional (rate-evolution data); the engine already reads latest-per-(competitor,
  stay_date). Re-running a job appends a fresh observation set — idempotent in effect.
- `scrape_runs`: one row per source per handler invocation. `running` on start;
  `succeeded` when ≥1 rate was written (per-date/per-competitor issues recorded in
  `error` text even on success); `failed` when nothing was written. No competitors in
  scope → no run row, result notes it (an empty run must not fake market freshness).
- Job result JSON: `{"sources": {"booking": {"rates_written": N, "dates_fetched": N,
  "unmatched": [...], "error": null}}, "rates_written": N}`.
- Handler raises (→ job `failed`) only when every source failed; partial success is a
  succeeded job with details.

### Config (env, `.env.example` documented)

| Var | Default | Meaning |
|---|---|---|
| `SCRAPE_SOURCES` | `booking` | comma-separated enabled sources |
| `SCRAPE_DAYS_AHEAD` | `90` | stay-date window (matches engine horizon) |
| `SCRAPE_DELAY_SECONDS` | `4.0` | base politeness delay between requests (jitter ±50%) |
| `SCRAPE_TIMEOUT_SECONDS` | `20.0` | per-request timeout |
| `SCRAPE_CURRENCY` | `RON` | requested display currency (parser still reads the page's) |

`SCRAPER_USER_AGENT` default stays the honest `Mozilla/5.0 (compatible;
PricePilotBot/0.1)`; operators may override via env (documented trade-off: Booking may
block obvious bots; scraping stays ToS-gray by prior product decision, politeness
enforced: ~90 req/night/city, 3–6s apart, immediate stop on 403/429).

### Refresh button fix (web + backend)

- Web: "Refresh data now" enqueues the real contract types in order:
  `scrape.competitor_rates {city, property_id}` → `ingest.events {city}` →
  `engine.generate_recommendations {property_id, horizon_days: 90}`. The single-worker
  FIFO poller guarantees execution order.
- Backend: `POST /jobs` validates that a `property_id` present in the payload resolves
  through the tenant-filtered context (400/404 otherwise) — stops cross-tenant job
  triggering. Unit test included.

### Live-site reality check

Anti-bot behavior can't be iterated from CI (fixtures only, repo hard rule). The
deliverable is: parser tested against a realistic fixture authored to current
Booking.com search markup (`data-testid="property-card"` / `"title"` /
`"price-and-discounted-price"`), plus the capture CLI so a human can save real HTML and
re-run the parser tests against it. `tests/fixtures/README.md` documents the loop.

---

## Part B — Real demand signals + calendar band

### Demand signals (`ingest.demand_signals` handler goes real)

- **Holidays**: `holidays` PyPI package (Romania), pure computation — no network.
  Window: today → today+365. Rows: `signal_type="public_holiday"`, `value=1`,
  `source="python-holidays"`, city from the job payload.
- **Weather**: Open-Meteo forecast API (free, keyless): daily
  `temperature_2m_max` + `precipitation_sum`, 16 days, city coords from a
  `CITY_COORDS` map (`sibiu` → 45.7983, 24.1256; unknown city → skip weather with a
  result note, not a failure). Rows: `signal_type="weather.temp_max_c"` /
  `"weather.precipitation_mm"`, `source="open-meteo"`.
- Idempotency: uuid5(city, signal_type, signal_date) + `ON CONFLICT (id) DO UPDATE`
  (value + created_at refresh — forecasts change; created_at is the freshness signal).
- Failure mode: any exception → whole job fails and rolls back (nightly retry);
  no partial-success bookkeeping.
- Tests: fixture JSON for Open-Meteo (fake client), holiday computation pinned against
  known 2026 dates (matches the current hardcoded list), upsert idempotency (integration).
- `ingest/holidays.py`'s hardcoded list is replaced by the package; existing callers: none.

No engine rule consumes these yet (follow-up in backlog: holiday/weather rules need a
factors-contract discussion) — this wave records the data and its freshness.

### Competitor band in factors (feeds the Part C calendar)

`competitor_position` factor gains `band_low` / `band_high` (2dp numbers, the min/max
of the competitor rates used for that stay date; omitted when no rates). This is
server-computed truth the calendar renders — the web never derives money figures.
`ENGINE_VERSION` bumps `"1"` → `"2"`; `shared/contracts/recommendation-factors.md`
updated in the same change; web renderer stays backward-compatible (band hidden when
fields absent — old rows keep rendering).

---

## Part C — Watercolor storybook UI (design handoff)

Port the handoff's visual language into the existing token system — not a rewrite.
Fidelity target is the handoff's "hifi" spec (exact hexes, type scale, spacing) with
these engineering choices:

- **Fonts**: self-hosted via `@fontsource/dm-serif-display` + `@fontsource/spectral`
  (400/500/600/700) — no runtime Google Fonts dependency (12-factor, GDPR, offline dev).
- **Assets**: `assets/houses/*.png` copied to `web/src/assets/houses/`; the login
  townscape recreated as a React SVG component from `Townscape.dc.html` (faithful:
  sunset gradient, silhouettes, spire, lit windows; clouds/birds animate subtly on the
  login screen only, disabled under `prefers-reduced-motion`).
- **Tokens**: `global.css` `:root` re-themed to the handoff palette (paper/cream/ink/
  terracotta/teal/gold). Existing semantic var names stay; new vars added where the
  handoff needs them. No inline magic colors in components.
- **Surfaces**:
  1. **Login** — split card (460px townscape hero + form), demo-credentials notice
     keeps its dev-only gate; the RO error string stays.
  2. **App shell** — 246px deep-teal sidebar (logo lockup, 5 nav items with inline
     line icons, `village-sidebar.png` pinned to the bottom), cream topbar (italic
     tagline, property switcher, user, logout).
  3. **Dashboard** — greeting header ("Good morning" by local time), restyled summary
     cards with corner icons, refresh flow from Part A; the placeholder chart panel
     becomes a link-card to the Recommendations calendar.
  4. **Recommendations** — month price calendar (6×7 grid): per-day price
     (recommended if pending, else current), competitor band caption ("vs low–high"
     from factors v2), position marker (green `<0.42` / amber `<0.72` / terracotta —
     ratio of price inside the band, display-only derivation), event pill days,
     weekend/out-of-month tints, legend; month prev/next; below: pending
     recommendation cards (restyled, unchanged behavior) + the illustrated empty
     state (house-sage, "All quiet on your street"). The calendar shows **one room
     type at a time**: room types are derived from the recommendation rows
     (`roomTypeName`), default = alphabetically first, switchable via a select in
     the calendar header when the property has more than one.
- **A11y hard lines** (audience skews older): body text ≥16px in `--ink` (9:1 on
  paper), `--ink-muted` only for eyebrows/captions ≥13px, focus rings visible
  (terracotta), hit targets ≥44px, calendar cells keyboard-reachable; day cells with a
  pending change are buttons that scroll to the matching card.
- **Tests**: existing suites stay green (update assertions where markup changed); new
  tests for calendar derivation (band ratio → marker class, event flag, out-of-month,
  missing band = no marker) and the empty state.

Events/Competitors/Settings pages inherit the shell + tokens; content untouched this wave.

---

## Verification (definition of done)

- Dataplane: `pytest` green incl. integration (orchestrator writes rates+runs against
  the dev DB via fake client; signals upsert; schema-sync untouched). `ruff` clean.
- Backend: `dotnet test` green (job payload validation tests added).
- Web: `npm test -- --run`, `npm run typecheck`, `npm run build` green.
- Contracts updated in the same wave: `jobs.md` (result shapes, refresh flow note),
  `recommendation-factors.md` (v2 band), `.env.example` (scrape vars).
- Manual demo path still works (`docs/demo.md`); dashboard refresh button actually
  enqueues jobs (against dev stack).
- Code-reviewer agent run per part; findings fixed before the next part.

## Out of scope (stays on the roadmap)

Airbnb fetching (JS-rendered; needs playwright), INS Tempo stats, events-calendar
scraping, holiday/weather engine rules, competitor CRUD UI, i18n (RO), billing,
channel push, VPS deploy.

## Risks

| Risk | Mitigation |
|---|---|
| Booking markup drift / anti-bot blocks | pure parser + capture CLI = cheap re-fixture loop; blocked → loud failed run, never a silent stale dataset; proxy env supported |
| Name matching misses a competitor | `unmatched` surfaced in job result; stopword/subset matcher tested against the three real demo competitors |
| Design port breaks RTL tests | tests assert roles/text, not colors; markup changes reviewed test-by-test |
| Calendar needs data web can't have | band comes from factors v2 (server truth); days without rows render empty gracefully |
