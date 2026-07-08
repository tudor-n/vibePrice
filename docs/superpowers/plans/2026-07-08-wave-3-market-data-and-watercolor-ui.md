# Wave 3 Implementation Plan — Real Market Data & Watercolor UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real Booking.com scraping pipeline + real demand signals feeding the engine's factors, and the watercolor-storybook UI from the design handoff.

**Architecture:** Scrapers become fully pure (URL planning + parsing); all network I/O lives in one `PoliteClient`; an orchestrator matches city-search listings to competitors and persists append-only `scraped_rates` + `scrape_runs` (ADR 0004). Demand signals (RO holidays + Open-Meteo weather) upsert idempotently into `demand_signals`. The web app is re-themed to the handoff (`Historical town sketch design/design_handoff_pricepilot_watercolor/README.md`) with a real month price calendar fed by factors v2 (`band_low`/`band_high`).

**Tech Stack:** Python 3.12 (httpx, BeautifulSoup, SQLAlchemy, pytest), ASP.NET Core 9 (xUnit), React 19 + TS + Vite (@fontsource, Vitest/RTL).

**Spec:** `docs/superpowers/specs/2026-07-08-wave-3-market-data-and-watercolor-ui-design.md`

## Global Constraints

- Money is `Decimal`/`decimal`, never float; currency travels with every amount.
- Scraper tests use fixtures only — **no live sites, no network in any test** (fake client / MockTransport).
- Dataplane never emits DDL; no schema changes in this wave.
- Every dataplane query on tenant-owned tables takes explicit scope; backend uses global query filters.
- Contract files change in the same commit as the code they describe (`jobs.md`, `recommendation-factors.md`, `.env.example`).
- Conventional commits. Dataplane: `.venv\Scripts\python -m pytest` + `ruff check src tests`. Backend: `dotnet build && dotnet test`. Web: `npm test -- --run`, `npm run typecheck`, `npm run build`.
- Web: react-query only (no useEffect fetching), tokens in `global.css` (no inline magic colors), types mirror contracts, ≥16px body text, visible focus, states for loading/error/empty.

---

## Part A — Scraping pipeline (dataplane + small backend fix)

### Task A1: Pure scraper interface + polite client

**Files:**
- Rewrite: `dataplane/src/pricepilot/scrapers/base.py`
- Create: `dataplane/src/pricepilot/scrapers/client.py`
- Modify: `dataplane/src/pricepilot/config.py` (scrape settings)
- Modify: `dataplane/src/pricepilot/scrapers/__init__.py`, `airbnb.py`
- Test: `dataplane/tests/test_scraper_client.py`
- Modify: `.env.example`

**Interfaces (later tasks rely on these exactly):**

```python
# base.py
@dataclass(frozen=True)
class PlannedRequest:
    url: str
    stay_date: date

@dataclass(frozen=True)
class ListingRate:      # one hotel card parsed from a search page
    name: str
    price: Decimal
    currency: str

@dataclass(frozen=True)
class RateObservation:  # kept from the old interface (persistence shape)
    competitor_id: UUID
    stay_date: date
    price: Decimal
    currency: str

class SearchScraper(ABC):
    name: ClassVar[str]
    implemented: ClassVar[bool] = True
    def __init__(self, *, currency: str = "RON") -> None: self.currency = currency
    @abstractmethod
    def plan_request(self, city: str, stay_date: date) -> PlannedRequest: ...
    @abstractmethod
    def parse_listings(self, html: str) -> list[ListingRate]: ...

# client.py
class ScraperFetchError(RuntimeError): ...
class ScraperBlockedError(ScraperFetchError): ...
class PoliteClient:
    def __init__(self, settings: Settings | None = None, *,
                 sleeper: Callable[[float], None] = time.sleep,
                 transport: httpx.BaseTransport | None = None,
                 rng: random.Random | None = None) -> None: ...
    def get(self, url: str) -> str: ...
    def close(self) -> None: ...
```

Client behavior (all tested via `httpx.MockTransport` + recorded fake sleeper):
- headers: `User-Agent` from settings, `Accept-Language: en-US,en;q=0.9`.
- politeness: before every request except the first, `sleeper(delay * rng.uniform(0.5, 1.5))`.
- 403/429 → `ScraperBlockedError` (no retry). Body containing any of
  `("px-captcha", "are you a human", "unusual traffic")` case-insensitive → same.
- timeouts / `httpx.TransportError` / 5xx → retry up to 2 extra attempts with
  `sleeper(delay * attempt)` backoff; still failing → `ScraperFetchError`.
- other 4xx → `ScraperFetchError` immediately.
- proxy: pass `settings.scraper_proxy_url` to httpx when non-empty.

Config additions (defaults per spec): `scrape_sources: str = "booking"`,
`scrape_days_ahead: int = 90`, `scrape_delay_seconds: float = 4.0`,
`scrape_timeout_seconds: float = 20.0`, `scrape_currency: str = "RON"`, plus
`def scrape_source_list(self) -> list[str]` (split on commas, strip, drop empties).

Airbnb becomes `class AirbnbScraper(SearchScraper)` with `implemented = False`, both
methods raising `NotImplementedError("Airbnb search results are client-rendered; "
"needs a browser-based fetcher — see roadmap")`. Registry unchanged keys:
`SCRAPERS = {"booking": BookingScraper, "airbnb": AirbnbScraper}`.

- [ ] A1.1 Write failing tests in `tests/test_scraper_client.py`: politeness delay skipped on first request and applied with jitter bounds after; blocked statuses raise `ScraperBlockedError`; challenge-body detection; retry-then-succeed on 500→500→200 with backoff sleeps recorded; retry exhaustion raises `ScraperFetchError`; 404 no-retry; UA header sent. Run: expect import failures.
- [ ] A1.2 Implement `client.py` + config fields; rewrite `base.py`; convert `airbnb.py`; fix `booking.py` minimally (subclass `SearchScraper`, keep old `parse_rates` temporarily so the old test still imports — replaced in A2).
- [ ] A1.3 `pytest tests/test_scraper_client.py -q` green; whole suite may have 2 failing legacy scraper tests only if A2 lands separately — otherwise keep green by doing A1+A2 in one commit.
- [ ] A1.4 Update `.env.example` (SCRAPE_* vars + UA trade-off comment). Commit `feat(dataplane): pure scraper interface + polite HTTP client`.

### Task A2: Booking.com search parser + realistic fixture

**Files:**
- Rewrite: `dataplane/src/pricepilot/scrapers/booking.py`
- Create: `dataplane/tests/fixtures/booking_search_sibiu.html` (replaces `booking_sample.html`)
- Rewrite: `dataplane/tests/test_scrapers.py`
- Modify: `dataplane/tests/fixtures/README.md` (re-capture loop)

**Interfaces:**
```python
BOOKING_SEARCH_URL = "https://www.booking.com/searchresults.html"
def build_search_url(city: str, stay_date: date, *, currency: str = "RON") -> str
def parse_price(text: str) -> Decimal | None       # None = unparseable
def detect_currency(text: str) -> str | None       # "RON"/"EUR"/"USD"/None
def parse_listings(html: str) -> list[ListingRate]
class BookingScraper(SearchScraper): name = "booking"
```

URL params (exact): `ss={city}`, `checkin={date}`, `checkout={date+1}`,
`group_adults=2`, `no_rooms=1`, `group_children=0`, `selected_currency={currency}`,
`lang=en-us` — via `urllib.parse.urlencode`.

Price normalization (pinned): strip NBSP/narrow-NBSP; regex `[0-9][0-9.,  ]*`;
remove spaces; if both `.` and `,` → the later char is the decimal separator, drop the
other; if a single separator with exactly 3 trailing digits and a non-empty head →
thousands separator (drop), else decimal point. `"1.234 lei"` → `1234`,
`"RON 412,50"` → `412.50`, `"€ 1,234.56"` → `1234.56`.

Currency detection: token map (`lei`/`ron` → RON, `€`/`eur` → EUR, `$`/`us$`/`usd` →
USD) case-insensitive; unknown → listing skipped (never guess money).

Parser: `[data-testid="property-card"]`; name from `[data-testid="title"]`; price from
`[data-testid="price-and-discounted-price"]` (fallback selector
`span[data-testid="price"]`); cards without a parsable price+currency are skipped.
Fixture: author realistic search-results HTML with ~6 property cards including
"Ramada by Wyndham Sibiu", "Hotel Imparatul Romanilor", "Casa Luxemburg" (diacritics
variant), a sold-out card (no price element), an NBSP-formatted price ("1 234 lei"),
and an unrelated hotel. Delete `booking_sample.html`.

- [ ] A2.1 Failing tests: URL builder exact string; `parse_price` table (incl. None); `detect_currency` table; fixture parse returns the expected `ListingRate` list (Decimals asserted); sold-out skipped; registry test updated (`SCRAPERS["booking"] is BookingScraper`, airbnb `implemented is False`).
- [ ] A2.2 Implement; delete old fixture; update fixtures README with the capture-CLI loop (A4).
- [ ] A2.3 Full dataplane suite green + ruff. Commit `feat(dataplane): Booking.com search-page parser against realistic fixture`.

### Task A3: Matching + orchestrator + job handler

**Files:**
- Create: `dataplane/src/pricepilot/scrapers/matching.py`
- Create: `dataplane/src/pricepilot/scrapers/orchestrator.py`
- Modify: `dataplane/src/pricepilot/scheduler/jobs.py` (real `handle_scrape_competitor_rates`)
- Test: `dataplane/tests/test_matching.py`, `dataplane/tests/test_scrape_orchestrator.py`,
  extend `dataplane/tests/integration/test_engine_e2e.py`-style DB test in
  `dataplane/tests/integration/test_scrape_persistence.py`
- Modify: `shared/contracts/jobs.md` (result shape + no-run-row-when-no-competitors note)

**Interfaces:**
```python
# matching.py
STOPWORDS: frozenset[str]  # hotel hostel pension pensiune pensiunea guesthouse
                           # apartments apartment aparthotel boutique by the la
def normalize_name(name: str) -> str
def significant_tokens(name: str, city: str) -> frozenset[str]
@dataclass(frozen=True)
class CompetitorRef:
    id: UUID
    name: str
def match_listings(listings: Sequence[ListingRate], competitors: Sequence[CompetitorRef],
                   city: str) -> dict[UUID, ListingRate]   # competitor id -> chosen listing

# orchestrator.py
def scrape_city(session, client: PoliteClient, *, city: str,
                competitors: Sequence[CompetitorRef], stay_dates: Sequence[date],
                sources: Sequence[str], currency: str) -> dict[str, Any]
# returns {"rates_written": int, "sources": {name: {"rates_written": int,
#   "dates_fetched": int, "dates_failed": int, "unmatched": [names],
#   "skipped": str|None, "error": str|None}}}
```

Matching algorithm (pinned by spec): normalize = casefold → NFKD, drop combining marks
→ non-alnum → space → collapse. Tokens minus STOPWORDS minus city tokens. Per
competitor: exact normalized equality wins; else subset (either direction, both sets
non-empty); best = largest intersection, tie → lexicographically smallest listing
name. Unmatched competitors reported.

Orchestrator per source: skip unimplemented (`skipped="not implemented"`, no run row);
insert `ScrapeRun(status="running")` + flush/commit; loop dates → `client.get(plan.url)`
→ `parse_listings` → `match_listings` → collect `RateObservation`s;
`ScraperBlockedError` → record, abort remaining dates for the source;
`ScraperFetchError` → record, continue. After loop: bulk `insert(ScrapedRate)` rows
(plain uuid4/captured_at defaults — append-only history), set run
`succeeded`/`failed` (`failed` iff zero observations) + `finished_at=now()` +
`error` = "; ".join(issues) or None. No competitors at all → `{"rates_written": 0,
"note": "no competitors configured"}` and **no run rows**. Handler raises `RuntimeError`
(→ job failed) only when every non-skipped source failed.

Handler `handle_scrape_competitor_rates(session, payload, *, client=None)`:
- `property_id` given → that property's competitors + its city (`Competitor.property_id == pid`).
- else `city` given → competitors of all properties in that city (join Property on city).
- both null → group all properties by city, run `scrape_city` per city, merge results.
- stay_dates = today..today+`scrape_days_ahead`; client = `client or PoliteClient()`
  (tests always inject); sources = `settings.scrape_source_list()`; close client if owned.

- [ ] A3.1 Failing tests. matching: Ramada/Imparatul/Luxemburg fixtures match; stopword+city stripping; exact beats subset; tie determinism; no-significant-tokens competitor only exact-matches; unmatched listed. orchestrator (fake client returning fixture HTML, fake scraper via SCRAPERS monkeypatch where needed): happy path writes observations for matched competitors × dates and a succeeded run; blocked on date 2 of 3 → partial rates, run succeeded with error text; all-blocked → run failed, handler raises; unimplemented source skipped without run row; no competitors → no run row. handler scope resolution: property_id → only that property's competitors (tenant isolation via ownership chain), city → all in city.
- [ ] A3.2 Implement matching.py (pure), orchestrator.py, handler rewrite.
- [ ] A3.3 Integration test (`@pytest.mark.integration`): against dev DB, fake client + demo competitors → `scraped_rates` rows inserted, `scrape_runs` row succeeded, re-run appends new observations (count doubles, latest-per-key picks newest `captured_at`).
- [ ] A3.4 Update `shared/contracts/jobs.md` result-shape section. Suite green + ruff. Commit `feat(dataplane): real scrape.competitor_rates — matching, orchestrator, scrape_runs`.

### Task A4: Capture + dry-run CLIs

**Files:**
- Create: `dataplane/src/pricepilot/scrapers/capture.py` (`python -m pricepilot.scrapers.capture booking --city sibiu --checkin 2026-08-07 --out tests/fixtures/booking_search_sibiu_live.html`)
- Create: `dataplane/src/pricepilot/scrapers/run.py` (`python -m pricepilot.scrapers.run --source booking --city sibiu --days 7 [--write]`)
- Test: `dataplane/tests/test_scraper_cli.py` (arg parsing + orchestration with fake client; `capture` writes file + prints parsed-listing count; `run` default dry-run prints table and writes nothing)

Both build `PoliteClient` only inside `main()` (import-safe for tests); `run.py`
resolves competitors from the DB exactly like the handler (city or property scope) and
in `--write` mode calls `scrape_city`; dry-run prints `date | competitor | price` rows
and the unmatched list. `capture.py` fetches ONE page, saves it verbatim, then runs
`parse_listings` on it and prints the count (immediate feedback whether current markup
parses; the human-in-the-loop anti-bot flow from the spec).

- [ ] A4.1 Failing CLI tests (invoke `main(argv, client=fake, session_factory=fake)` seams).
- [ ] A4.2 Implement both modules with argparse; document in `dataplane/CLAUDE.md` (Scrapers section) and `tests/fixtures/README.md`.
- [ ] A4.3 Suite + ruff green. Commit `feat(dataplane): scraper capture & dry-run CLIs for live iteration`.

### Task A5: Backend — job payload ownership validation

**Files:**
- Modify: `backend/src/PricePilot.Api/Endpoints/JobEndpoints.cs`
- Modify (if needed): `backend/src/PricePilot.Application/*` (`IPropertyService` — add `Task<bool> ExistsAsync(Guid propertyId, CancellationToken ct)` if no suitable lookup exists) + `backend/src/PricePilot.Infrastructure/Services/PropertyService.cs`
- Test: `backend/tests/PricePilot.UnitTests/JobPayloadValidationTests.cs` (mirror existing endpoint-test style)

Behavior: when the JSON payload contains a non-null `property_id`: unparseable Guid →
400 `{"error": "payload.property_id must be a UUID"}`; parseable but not resolvable
through the tenant-filtered context → 404. Null/absent → unchanged behavior. The
tenant filter does the isolation — no manual tenant comparison.

- [ ] A5.1 Failing tests: valid own property → 202; other tenant's property → 404; garbage guid → 400; no payload → 202.
- [ ] A5.2 Implement; `dotnet build && dotnet test` green. Commit `fix(api): jobs POST validates payload property ownership`.

---

## Part B — Demand signals + factors band

### Task B1: recommendation-factors v2 contract (band) — commit FIRST (Part C reads it)

**Files:**
- Modify: `shared/contracts/recommendation-factors.md`

`competitor_position` example gains `"band_low": 380.00, "band_high": 455.00` with the
rule: *present iff `sample_size > 0`; min/max of the competitor rates used for that
stay date; consumers must tolerate absence (v1 rows)*. `engine_version` example value
becomes `"2"`; changelog note appended at the bottom of the file.

- [ ] B1.1 Edit + commit `docs(contracts): factors v2 — competitor_position band_low/band_high`.

### Task B2: engine emits the band + ENGINE_VERSION=2

**Files:**
- Modify: `dataplane/src/pricepilot/engine/rules/competitor_position.py` (extra gains
  `"band_low": min(rates)`, `"band_high": max(rates)` in the has-rates branch — Decimals,
  serialization already quantizes to 2dp)
- Modify: `dataplane/src/pricepilot/engine/__init__.py` (`ENGINE_VERSION = "2"`)
- Test: extend `dataplane/tests/test_rules.py` + `tests/test_explainer.py` (payload
  factor for competitor_position includes band keys; zero-rates branch has neither key)

- [ ] B2.1 Failing tests → implement → suite green. Commit `feat(engine): competitor band in factors (engine v2)`.

### Task B3: holidays via `holidays` package

**Files:**
- Modify: `dataplane/pyproject.toml` (`"holidays>=0.50"` dependency; reinstall `-e ".[dev]"`)
- Rewrite: `dataplane/src/pricepilot/ingest/holidays.py`
- Create: `dataplane/src/pricepilot/ingest/signals.py` (shared upsert)
- Test: `dataplane/tests/test_ingest_holidays.py`, `dataplane/tests/test_ingest_signals.py`

**Interfaces:**
```python
# signals.py — mirrors ingest/events.py upsert pattern
SIGNALS_UUID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://pricepilot.dev/demand-signals")
@dataclass(frozen=True)
class SignalRecord:
    city: str
    signal_type: str
    signal_date: date
    value: Decimal
def signal_row_id(city: str, signal_type: str, signal_date: date) -> UUID
def upsert_signals(session, records: Sequence[SignalRecord], *, source: str) -> int
# ON CONFLICT (id) DO UPDATE set value, source, created_at=func.now()  ← freshness

# holidays.py
def romanian_public_holidays(year: int) -> list[date]          # holidays.Romania
def holiday_signal_records(city: str, start: date, end: date) -> list[SignalRecord]
# signal_type="public_holiday", value=Decimal("1")
```

- [ ] B3.1 Failing tests: 2026 package output contains the 16 known dates (the old hardcoded list — pins the package against regressions); 2027 works (no NotImplementedError); records windowed inclusively; uuid5 stable; upsert re-run doesn't duplicate (unit-level: SQL statement shape, integration-level in B5).
- [ ] B3.2 Implement; suite + ruff green. Commit `feat(dataplane): Romanian public holidays via holidays package + signal upsert`.

### Task B4: Open-Meteo weather

**Files:**
- Rewrite: `dataplane/src/pricepilot/ingest/weather.py`
- Create: `dataplane/tests/fixtures/open_meteo_sibiu.json`
- Test: `dataplane/tests/test_ingest_weather.py`

**Interfaces:**
```python
CITY_COORDS: dict[str, tuple[float, float]] = {"sibiu": (45.7983, 24.1256)}
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
def build_forecast_url(city: str) -> str          # raises KeyError for unknown city
def parse_forecast(payload: dict, city: str) -> list[SignalRecord]
def fetch_weather_signals(city: str, *, http_get: Callable[[str], dict]) -> list[SignalRecord]
```
URL params: `latitude`, `longitude`, `daily=temperature_2m_max,precipitation_sum`,
`forecast_days=16`, `timezone=UTC`. Signal types `weather.temp_max_c` /
`weather.precipitation_mm`; values `Decimal(str(v)).quantize(Decimal("0.0001"))`;
null entries skipped. `http_get` default does `httpx.get(url, timeout=20).raise_for_status().json()`
— tests always inject a fixture-backed callable.

- [ ] B4.1 Failing tests: URL exact; fixture parses into expected records (Decimal asserted); nulls skipped; unknown city KeyError.
- [ ] B4.2 Implement; suite green. Commit `feat(dataplane): Open-Meteo weather signals`.

### Task B5: real `handle_ingest_demand_signals`

**Files:**
- Modify: `dataplane/src/pricepilot/scheduler/jobs.py`
- Test: extend `dataplane/tests/test_scrape_orchestrator.py`-style unit tests in
  `dataplane/tests/test_jobs_demand_signals.py` + integration
  `dataplane/tests/integration/test_demand_signals.py`

Handler `handle_ingest_demand_signals(session, payload, *, weather_http_get=None)`:
city from payload (default "sibiu"); holidays window today→today+365; weather only when
city in `CITY_COORDS` else result notes `"weather": "skipped: no coordinates"`;
`upsert_signals(..., source="python-holidays")` / `source="open-meteo"`; result
`{"city": c, "signals_written": total, "holidays_written": h, "weather_written": w}`.
Any exception propagates (job fails, rolls back — spec: all-or-nothing).

- [ ] B5.1 Failing unit tests (fake session boundaries where practical) + integration: rows exist, re-run stable count, created_at refreshed.
- [ ] B5.2 Implement; suite + ruff green; update `jobs.md` result shape. Commit `feat(dataplane): real ingest.demand_signals (holidays + weather)`.

---

## Part C — Watercolor UI (dispatched to implementer agent; web/ only)

The pixel-level truth is the handoff:
`Historical town sketch design/design_handoff_pricepilot_watercolor/README.md`
(tokens table, type scale, per-screen specs) + `Townscape.dc.html` (SVG reference)
+ `assets/houses/*.png`. Repo rules: `web/CLAUDE.md`. Do NOT copy inline styles or
`support.js`; port values into `global.css` tokens.

### Task C1: tokens, fonts, assets
Install `@fontsource/dm-serif-display` + `@fontsource/spectral` (400/500/600/700 +
italic 400 for display), import in `main.tsx`; copy the 8 PNGs to
`web/src/assets/houses/`; re-theme `global.css` `:root` to the handoff palette
(keep existing semantic var names; add `--bg-paper`, `--terracotta`, `--teal`,
`--gold`, etc. per the handoff token table); base body = Spectral 16px on
`--bg-paper`, headings DM Serif Display; keep focus-visible ring (terracotta);
`prefers-reduced-motion` global guard. All existing tests must stay green after this
task (`npm test -- --run`, typecheck, build).

### Task C2: Townscape SVG + shared illustration pieces
`web/src/components/Townscape.tsx` — faithful recreation of the hero from
`Townscape.dc.html` (sunset gradient stops from the handoff, cloud/bird groups with
CSS animation used ONLY on the login screen, `aria-hidden`, reduced-motion disables);
export a `TownSilhouette` variant for decorative card footers. Snapshot-free tests:
renders an `<svg>` with `aria-hidden="true"`, animation class present only when
`animated` prop set.

### Task C3: Login split layout (handoff screen 1)
Restyle `LoginPage.tsx` per handoff §Screens/1: split card, hero panel with
`<Townscape animated />`, logo lockup, tagline; form panel (Welcome back, labels,
focus ring, terracotta CTA, demo notice keeps `import.meta.env.DEV` gate and the RO
error string). Update `LoginPage.test.tsx` assertions only where markup changed
(labels/roles stay). Keep ≥44px targets.

### Task C4: App shell (handoff screen 2 chrome)
`Layout.tsx` + CSS: 246px `--teal` sidebar (logo lockup, 5 nav items with inline
hand-drawn-style line icons `web/src/components/icons.tsx` — 18px, stroke 1.7, round
caps; active = terracotta pill), `village-sidebar.png` pinned to the sidebar bottom
(decorative, `alt=""`); cream topbar: italic "Your pricing copilot" (DM Serif
Display), existing property `<select>` restyled, user name from session, Log out
outline button. Responsive: sidebar collapses to top strip <800px (keep current
breakpoint behavior). Existing Layout-dependent tests stay green.

### Task C5: Dashboard (handoff screen 2) + refresh fix
Restyle `DashboardPage.tsx`: greeting header "Good morning, {firstName}" (from stored
UserInfo; time-of-day aware: morning/afternoon/evening by local hour), sub
"{property} · {city} — here's what changed while you slept."; three summary cards with
corner icons + eyebrow labels per handoff; **replace the broken `refresh_all` trigger**:
on click, enqueue in order via `useTriggerJob().mutateAsync`:
`{type: 'scrape.competitor_rates', payload: {city: property.city, property_id: property.id}}`
→ `{type: 'ingest.events', payload: {city: property.city}}`
→ `{type: 'engine.generate_recommendations', payload: {property_id: property.id, horizon_days: 90}}`;
button shows busy state until all three are accepted; failure shows ErrorState.
Bottom panel becomes a dashed "Price calendar" card linking to `/recommendations`
(house cluster illustration). Tests: update dashboard tests; add one asserting the
three enqueued types in order (mock the mutation).

### Task C6: Recommendations page — price calendar + cards + empty state (handoff screen 3)
- `web/src/features/recommendations/calendarModel.ts` — **pure**, fully tested:
  `buildCalendarModel(recommendations, monthStart, roomTypeName)` → 6×7 `CalendarDay[]`
  (`{date, inMonth, isWeekend, price?, currency?, bandLow?, bandHigh?, position?,
  markerClass?, eventName?, hasPending, recommendationId?}`); price = recommended for
  pending rows else current; band from the `competitor_position` factor's
  `band_low`/`band_high` (tolerate absence — factors v1 rows); position =
  `(price - low) / (high - low)` clamped 0..1 (display-only derivation); marker class
  green `<0.42`, amber `<0.72`, else terracotta; event flag = the `event_impact`
  factor has non-empty `event_ids`; the pill is a generic "event day" star pill whose
  `title`/tooltip is that factor's `reason` sentence (never re-derive event names
  client-side). Room types derived from rows; default alphabetically first.
- Calendar UI per handoff §3 (weekday header, cell anatomy, legend, month prev/next
  bounded to months having data, room-type select when >1).
- Cells with `hasPending` are `<button>`s scrolling to (and highlighting) the matching
  recommendation card below.
- Restyle `RecommendationCard.tsx` (struck current → big recommended, factor pills,
  impact callout, Accept/Dismiss per handoff; behavior unchanged).
- Empty state: dashed card + `house-sage.png` + "All quiet on your street".
- Tests: calendarModel unit tests (band ratio→class incl. boundaries 0.42/0.72,
  missing band → no marker, low==high → position 1 guard, out-of-month, weekend,
  pending vs decided price choice); page tests for room-type select + empty state.

### Task C7: Sweep + verification
Events/Competitors/Settings inherit tokens (adjust only broken styles); States/
FreshnessBadge/Money restyle to handoff (warn callout, pills); a11y pass (focus ring
everywhere, `alt`/`aria-hidden` on illustrations, contrast: `--ink-muted` only ≥13px
captions); `npm test -- --run` + `npm run typecheck` + `npm run build` all green;
report diff summary + test output.

---

## Execution notes

- Order: B1 (contract v2) commits before C6 is coded against it. Part C runs as a
  background implementer agent (web/ only, no commits — the orchestrator reviews,
  runs the suite, and commits). Parts A, B, A5 run inline in the main session.
- Code-reviewer agent runs per part (A, B, C) before its final commit is folded into
  the roadmap update.
- Roadmap + memory updates close the wave.
