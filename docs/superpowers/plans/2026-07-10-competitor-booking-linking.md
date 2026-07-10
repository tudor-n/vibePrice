# Competitor Booking Linking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give discovered Google competitors reliable Booking prices by linking each competitor to its Booking listing once (stored in `competitors.source_url`), then matching nightly search cards by stable Booking slug instead of fuzzy Google names.

**Architecture:** Dataplane-only. A one-time `link_competitor_sources` job searches Booking per competitor and stores the winning listing's URL. The recurring scrape matches listings to linked competitors by Booking slug (exact), name-matches only still-unlinked rows, and adaptively pages the city search until all competitors are found. No schema change — `source_url` already exists and is dataplane-writable.

**Tech Stack:** Python 3.12, SQLAlchemy Core, BeautifulSoup, APScheduler, pytest.

## Global Constraints

- **No schema migration; no DDL from Python.** Reuse existing `competitors.source_url` (nullable, dataplane-written). `db/tables.py` maps only.
- **Scrapers are pure; tests use saved fixtures in `tests/fixtures/` only — never live sites.**
- **Money is `Decimal`, never float; currency travels with every amount.** (Unchanged here — no new money paths.)
- **Contracts updated in the same PR:** `shared/contracts/jobs.md` (new job type) and `shared/contracts/table-ownership.md` (`source_url` note). `recommendation-factors.md` is unchanged.
- **Tenant isolation:** the link job writes only `competitors.source_url` on existing rows (tenant already set); scope queries by `property_id` when given.
- **Job handlers must be idempotent.** The linker only fills `NULL` links; never overwrites an existing one.
- Run tests: `cd dataplane && .venv\Scripts\python -m pytest` ; lint: `.venv\Scripts\python -m ruff check src tests`.

---

## File structure

- `src/pricepilot/scrapers/base.py` — `ListingRate` gains `url`; `SearchScraper` gains `identity_of` + `plan_request(page=…)`.
- `src/pricepilot/scrapers/booking.py` — `booking_slug()`, URL extraction, `identity_of`, paginated `build_search_url`/`plan_request`.
- `src/pricepilot/scrapers/matching.py` — `CompetitorRef.source_url`; two-tier `match_listings` (slug then name).
- `src/pricepilot/scrapers/linker.py` — **new**: pure `resolve_competitor_link`.
- `src/pricepilot/scrapers/orchestrator.py` — select `source_url`; pass `identity_of`; adaptive pagination.
- `src/pricepilot/scheduler/jobs.py` — `handle_link_competitor_sources`, register handler, chain from `discover_competitors`.
- `src/pricepilot/scheduler/main.py` — nightly link sweep.
- `src/pricepilot/config.py` — `scrape_max_pages`, `competitor_link_max_results`.
- `.env.example`, `shared/contracts/jobs.md`, `shared/contracts/table-ownership.md` — docs/contracts.
- Tests: `tests/fixtures/booking_search_sibiu.html` (add links), `tests/fixtures/booking_link_ramada.html` (new), `tests/test_scrapers.py`, `tests/test_matching.py`, `tests/test_linker.py` (new), `tests/test_link_jobs.py` (new), `tests/test_scrape_orchestrator.py`, `tests/test_place_jobs.py`.

---

### Task 1: Booking listing identity — slug + card URL

**Files:**
- Modify: `src/pricepilot/scrapers/base.py`
- Modify: `src/pricepilot/scrapers/booking.py`
- Modify: `tests/fixtures/booking_search_sibiu.html` (add title-link anchors)
- Test: `tests/test_scrapers.py`

**Interfaces:**
- Produces: `booking_slug(url: str | None) -> str | None`; `ListingRate.url: str | None`; `BookingScraper.identity_of(url) -> str | None`.

- [ ] **Step 1: Add hotel links to the fixture cards**

In `tests/fixtures/booking_search_sibiu.html`, wrap each `<div data-testid="title">…</div>` in a Booking hotel link. Apply to all real (non-soldout) cards; use a distinct slug per hotel. Example for the first two:

```html
<h3><a data-testid="title-link" href="/hotel/ro/ramada-sibiu.html"><div data-testid="title">Ramada by Wyndham Sibiu</div></a></h3>
```
```html
<h3><a data-testid="title-link" href="/hotel/ro/imparatul-romanilor.en-gb.html"><div data-testid="title">Hotel Împăratul Romanilor</div></a></h3>
```

Give `Casa Luxemburg` `href="/hotel/ro/casa-luxemburg-sibiu.html"`. Leave the sold-out card (`Hotel Sold Out Palace`) as-is (no link, still unpriced).

- [ ] **Step 2: Write the failing tests**

Add to `tests/test_scrapers.py`:

```python
from pricepilot.scrapers.booking import booking_slug, parse_listings


def test_booking_slug_extracts_country_and_slug():
    assert booking_slug("https://www.booking.com/hotel/ro/ramada-sibiu.html") == "ro/ramada-sibiu"


def test_booking_slug_ignores_locale_and_query():
    url = "https://www.booking.com/hotel/ro/imparatul-romanilor.en-gb.html?checkin=2026-07-10"
    assert booking_slug(url) == "ro/imparatul-romanilor"


def test_booking_slug_none_for_non_hotel_or_empty():
    assert booking_slug("https://www.booking.com/searchresults.html") is None
    assert booking_slug(None) is None
    assert booking_slug("") is None


def test_parse_listings_extracts_hotel_url(fixtures_dir):
    html = (fixtures_dir / "booking_search_sibiu.html").read_text(encoding="utf-8")
    by_name = {listing.name: listing for listing in parse_listings(html)}
    ramada = by_name["Ramada by Wyndham Sibiu"]
    assert ramada.url == "https://www.booking.com/hotel/ro/ramada-sibiu.html"
    assert booking_slug(ramada.url) == "ro/ramada-sibiu"
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `.venv\Scripts\python -m pytest tests/test_scrapers.py -k "slug or hotel_url" -v`
Expected: FAIL — `ImportError: cannot import name 'booking_slug'` / `ListingRate` has no `url`.

- [ ] **Step 4: Add `url` to `ListingRate` and `identity_of` to the base scraper**

In `src/pricepilot/scrapers/base.py`, update `ListingRate` and add `identity_of` + a `page` param to `plan_request`:

```python
@dataclass(frozen=True)
class ListingRate:
    """One property card parsed from a search page, not yet tied to a competitor."""

    name: str
    price: Decimal
    currency: str
    url: str | None = None
```

```python
    @abstractmethod
    def plan_request(self, city: str, stay_date: date, *, page: int = 0) -> PlannedRequest:
        """Build the search-results request for one city, stay date, and result page."""

    @abstractmethod
    def parse_listings(self, html: str) -> list[ListingRate]:
        """Extract listings from a search-results page."""

    def identity_of(self, url: str | None) -> str | None:
        """Stable listing identity for slug-matching; None when the source has none."""
        return None
```

- [ ] **Step 5: Implement `booking_slug`, URL extraction, and Booking `identity_of`**

In `src/pricepilot/scrapers/booking.py`, add the import and constant near the top:

```python
from urllib.parse import urljoin, urlsplit

BOOKING_BASE_URL = "https://www.booking.com"

#: Booking paginates search results in blocks of this size (the `offset` param).
_PAGE_SIZE = 25
```

Add the slug helper (module-level):

```python
def booking_slug(url: str | None) -> str | None:
    """Stable Booking hotel id from a listing URL, e.g. 'ro/continental-forum-sibiu'.

    Locale infixes ('.en-gb') and query strings are stripped so the same hotel
    always yields the same key. Returns None for non-hotel or empty URLs.
    """
    if not url:
        return None
    parts = urlsplit(url).path.strip("/").split("/")
    # Booking hotel URLs look like /hotel/<cc>/<slug>[.<locale>].html
    if len(parts) < 3 or parts[0] != "hotel":
        return None
    country, filename = parts[1], parts[2]
    slug = filename.split(".", 1)[0]
    if not country or not slug:
        return None
    return f"{country}/{slug}"
```

In `parse_listings`, read the card's title link and pass `url`:

```python
    for card in soup.select('[data-testid="property-card"]'):
        title_el = card.select_one('[data-testid="title"]')
        price_el = next(
            (found for sel in _PRICE_SELECTORS if (found := card.select_one(sel))),
            None,
        )
        if title_el is None or price_el is None:
            continue  # sold-out / unpriced card
        name = title_el.get_text(strip=True)
        price_text = price_el.get_text(" ", strip=True)
        price = parse_price(price_text)
        currency = detect_currency(price_text)
        if not name or price is None or currency is None:
            continue
        link_el = card.select_one('a[data-testid="title-link"]')
        href = link_el.get("href") if link_el is not None else None
        url = urljoin(BOOKING_BASE_URL, href) if href else None
        listings.append(ListingRate(name=name, price=price, currency=currency, url=url))
```

Add `identity_of` to `BookingScraper` (below `parse_listings`):

```python
    def identity_of(self, url: str | None) -> str | None:
        return booking_slug(url)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `.venv\Scripts\python -m pytest tests/test_scrapers.py -v`
Expected: PASS (all, including existing parse tests).

- [ ] **Step 7: Commit**

```bash
git add src/pricepilot/scrapers/base.py src/pricepilot/scrapers/booking.py tests/fixtures/booking_search_sibiu.html tests/test_scrapers.py
git commit -m "feat(scrapers): expose Booking listing URL + stable slug"
```

---

### Task 2: Slug-aware two-tier matching

**Files:**
- Modify: `src/pricepilot/scrapers/matching.py`
- Modify: `src/pricepilot/scrapers/orchestrator.py` (select `source_url`, pass `identity_of`)
- Test: `tests/test_matching.py`

**Interfaces:**
- Consumes: `booking_slug` (Task 1), `ListingRate.url` (Task 1).
- Produces: `CompetitorRef(id, name, source_url=None)`; `match_listings(listings, competitors, city, *, identity_of=_no_identity)`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_matching.py`:

```python
from decimal import Decimal

from pricepilot.scrapers.base import ListingRate
from pricepilot.scrapers.booking import booking_slug
from pricepilot.scrapers.matching import CompetitorRef, match_listings


def _listing(name, slug):
    url = f"https://www.booking.com/hotel/ro/{slug}.html" if slug else None
    return ListingRate(name=name, price=Decimal("400"), currency="RON", url=url)


def test_linked_competitor_matches_by_slug_despite_name_mismatch():
    listings = [_listing("Ramada by Wyndham Sibiu", "ramada-sibiu")]
    competitor = CompetitorRef(
        id=__import__("uuid").uuid4(),
        name="Totally Different Name",
        source_url="https://www.booking.com/hotel/ro/ramada-sibiu.en-gb.html",
    )
    matched = match_listings(listings, [competitor], "sibiu", identity_of=booking_slug)
    assert matched[competitor.id].name == "Ramada by Wyndham Sibiu"


def test_linked_competitor_does_not_fall_back_to_name():
    # Linked to a slug absent from the page; a same-name listing must NOT match.
    listings = [_listing("Hotel Ramada Sibiu", "some-other-hotel")]
    competitor = CompetitorRef(
        id=__import__("uuid").uuid4(),
        name="Hotel Ramada Sibiu",
        source_url="https://www.booking.com/hotel/ro/ramada-sibiu.html",
    )
    matched = match_listings(listings, [competitor], "sibiu", identity_of=booking_slug)
    assert competitor.id not in matched


def test_unlinked_competitor_falls_back_to_name():
    listings = [_listing("Hotel Ramada Sibiu", "ramada-sibiu")]
    competitor = CompetitorRef(id=__import__("uuid").uuid4(), name="Ramada")
    matched = match_listings(listings, [competitor], "sibiu", identity_of=booking_slug)
    assert matched[competitor.id].name == "Hotel Ramada Sibiu"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv\Scripts\python -m pytest tests/test_matching.py -k "slug or linked or fall_back" -v`
Expected: FAIL — `CompetitorRef` has no `source_url` / `match_listings` got unexpected keyword `identity_of`.

- [ ] **Step 3: Implement the two-tier matcher**

In `src/pricepilot/scrapers/matching.py`, add `source_url` to `CompetitorRef`:

```python
@dataclass(frozen=True)
class CompetitorRef:
    """The slice of a ``competitors`` row that matching needs."""

    id: UUID
    name: str
    source_url: str | None = None
```

Add the import and a default identity, and rewrite `match_listings` to try slug first:

```python
from collections.abc import Callable, Sequence


def _no_identity(url: str | None) -> str | None:
    """Default identity: a source with no stable per-listing id (name-only)."""
    return None


def match_listings(
    listings: Sequence[ListingRate],
    competitors: Sequence[CompetitorRef],
    city: str,
    *,
    identity_of: Callable[[str | None], str | None] = _no_identity,
) -> dict[UUID, ListingRate]:
    """Choose at most one listing per competitor; omit competitors with no match.

    Two tiers per competitor: a *linked* competitor (``source_url`` set and the
    source exposes an identity) matches only the listing with the same stable
    identity — exact, never a name guess. An *unlinked* competitor falls back to
    significant-token name matching.
    """
    matched: dict[UUID, ListingRate] = {}
    normalized_listings = [(listing, normalize_name(listing.name)) for listing in listings]

    listing_by_identity: dict[str, ListingRate] = {}
    for listing, _ in normalized_listings:
        ident = identity_of(listing.url)
        if ident is not None:
            listing_by_identity.setdefault(ident, listing)  # first card wins

    for competitor in competitors:
        # Tier 1: linked → exact identity match only (no name fallback).
        competitor_ident = identity_of(competitor.source_url)
        if competitor_ident is not None:
            listing = listing_by_identity.get(competitor_ident)
            if listing is not None:
                matched[competitor.id] = listing
            continue

        # Tier 2: unlinked → significant-token name matching.
        competitor_norm = normalize_name(competitor.name)
        exact = [
            listing
            for listing, listing_norm in normalized_listings
            if listing_norm == competitor_norm
        ]
        if exact:
            matched[competitor.id] = min(exact, key=lambda listing: listing.name)
            continue

        competitor_tokens = significant_tokens(competitor.name, city)
        if not competitor_tokens:
            continue

        candidates: list[tuple[int, ListingRate]] = []
        for listing, _ in normalized_listings:
            listing_tokens = significant_tokens(listing.name, city)
            if not listing_tokens:
                continue
            if competitor_tokens <= listing_tokens or listing_tokens <= competitor_tokens:
                overlap = len(competitor_tokens & listing_tokens)
                candidates.append((overlap, listing))
        if candidates:
            best_overlap = max(overlap for overlap, _ in candidates)
            matched[competitor.id] = min(
                (listing for overlap, listing in candidates if overlap == best_overlap),
                key=lambda listing: listing.name,
            )
    return matched
```

Note: `ListingRate` is already imported in `matching.py`; keep the existing `import unicodedata` and other imports. Remove the now-duplicated `from collections.abc import Sequence` if it already exists (merge into the `Callable, Sequence` import).

- [ ] **Step 4: Pass `source_url` and `identity_of` through the orchestrator**

In `src/pricepilot/scrapers/orchestrator.py`, extend the scope query to select `source_url`:

```python
    query = select(
        Competitor.id, Competitor.name, Competitor.source_url, Property.city
    ).join(Property, Competitor.property_id == Property.id)
    if property_id is not None:
        query = query.where(Competitor.property_id == property_id)
    elif city is not None:
        query = query.where(func.lower(Property.city) == city.strip().lower())

    grouped: dict[str, list[CompetitorRef]] = {}
    for competitor_id, name, source_url, property_city in session.execute(query):
        grouped.setdefault(property_city, []).append(
            CompetitorRef(id=competitor_id, name=name, source_url=source_url)
        )
    return grouped
```

In `collect_source_observations`, pass the scraper's identity to the matcher (the single existing `match_listings(...)` call):

```python
            for competitor_id, listing in match_listings(
                listings, competitors, city, identity_of=scraper.identity_of
            ).items():
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv\Scripts\python -m pytest tests/test_matching.py tests/test_scrape_orchestrator.py -v`
Expected: PASS (existing orchestrator/matching tests still green — the default `identity_of` preserves name-only behavior).

- [ ] **Step 6: Commit**

```bash
git add src/pricepilot/scrapers/matching.py src/pricepilot/scrapers/orchestrator.py tests/test_matching.py
git commit -m "feat(scrapers): match linked competitors by Booking slug, name-fallback otherwise"
```

---

### Task 3: Link resolver (pure)

**Files:**
- Create: `src/pricepilot/scrapers/linker.py`
- Test: `tests/test_linker.py`

**Interfaces:**
- Consumes: `match_listings`, `CompetitorRef` (Task 2); `ListingRate` (Task 1).
- Produces: `resolve_competitor_link(cards, competitor, city, *, identity_of) -> str | None`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_linker.py`:

```python
"""Pure competitor→Booking link resolution (no I/O)."""

import uuid
from decimal import Decimal

from pricepilot.scrapers.base import ListingRate
from pricepilot.scrapers.booking import booking_slug
from pricepilot.scrapers.linker import resolve_competitor_link
from pricepilot.scrapers.matching import CompetitorRef


def _card(name, slug):
    return ListingRate(
        name=name,
        price=Decimal("400"),
        currency="RON",
        url=f"https://www.booking.com/hotel/ro/{slug}.html",
    )


def test_resolve_returns_matched_card_url():
    cards = [_card("Hotel Ramada Sibiu", "ramada-sibiu"), _card("Casa Luxemburg", "casa-lux")]
    competitor = CompetitorRef(id=uuid.uuid4(), name="Ramada by Wyndham Sibiu")
    url = resolve_competitor_link(cards, competitor, "sibiu", identity_of=booking_slug)
    assert url == "https://www.booking.com/hotel/ro/ramada-sibiu.html"


def test_resolve_returns_none_when_no_confident_match():
    cards = [_card("Completely Unrelated Inn", "unrelated-inn")]
    competitor = CompetitorRef(id=uuid.uuid4(), name="Ramada by Wyndham Sibiu")
    assert resolve_competitor_link(cards, competitor, "sibiu", identity_of=booking_slug) is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv\Scripts\python -m pytest tests/test_linker.py -v`
Expected: FAIL — `ModuleNotFoundError: pricepilot.scrapers.linker`.

- [ ] **Step 3: Implement the resolver**

Create `src/pricepilot/scrapers/linker.py`:

```python
"""Resolve a competitor to its Booking listing URL (pure).

Runs the same conservative :func:`match_listings` used at scrape time, but
against a *name-scoped* Booking search (high recall for one specific hotel).
The competitor is unlinked here (no ``source_url``), so matching uses the
significant-token name tier; the winning card's URL becomes the stored link.
Returns None when no card matches confidently — an honest "unlinked", never a
guess. Keeping the decision in one pure function makes it testable and, later,
correctable by a human.
"""

from collections.abc import Callable, Sequence

from pricepilot.scrapers.base import ListingRate
from pricepilot.scrapers.matching import CompetitorRef, match_listings


def resolve_competitor_link(
    cards: Sequence[ListingRate],
    competitor: CompetitorRef,
    city: str,
    *,
    identity_of: Callable[[str | None], str | None],
) -> str | None:
    """Return the Booking URL of the card that matches ``competitor``, or None."""
    matched = match_listings(cards, [competitor], city, identity_of=identity_of)
    listing = matched.get(competitor.id)
    return listing.url if listing is not None else None
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv\Scripts\python -m pytest tests/test_linker.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pricepilot/scrapers/linker.py tests/test_linker.py
git commit -m "feat(scrapers): pure competitor->Booking link resolver"
```

---

### Task 4: `link_competitor_sources` job + config + contracts

**Files:**
- Modify: `src/pricepilot/config.py` (`competitor_link_max_results`)
- Modify: `src/pricepilot/scheduler/jobs.py` (query helper, handler, register)
- Modify: `shared/contracts/jobs.md`, `shared/contracts/table-ownership.md`, `.env.example`
- Create: `tests/fixtures/booking_link_ramada.html`
- Test: `tests/test_link_jobs.py`

**Interfaces:**
- Consumes: `resolve_competitor_link` (Task 3); `BookingScraper` (Task 1); `CompetitorRef` (Task 2); `PoliteClient`, `ScraperBlockedError`, `ScraperFetchError`, `enqueue_job`, `_parse_uuid`, `get_settings` (existing in `jobs.py`).
- Produces: `handle_link_competitor_sources(session, payload, *, client=None) -> dict`, registered under `"link_competitor_sources"`.

- [ ] **Step 1: Add the config setting**

In `src/pricepilot/config.py`, under the Places block (near `competitor_discovery_max`):

```python
    # Competitor→Booking linking + scrape coverage.
    competitor_link_max_results: int = 10   # cards considered per link search
```

- [ ] **Step 2: Create the link-search fixture**

Create `tests/fixtures/booking_link_ramada.html` — a minimal name-scoped Booking search result whose top card is the target hotel:

```html
<!doctype html>
<html><body>
<div data-testid="searchresults-list">
  <div data-testid="property-card" class="c-property-card">
    <div class="card-body">
      <h3><a data-testid="title-link" href="/hotel/ro/ramada-sibiu.html"><div data-testid="title">Ramada by Wyndham Sibiu</div></a></h3>
      <span data-testid="price-and-discounted-price">RON 512</span>
    </div>
  </div>
</div>
</body></html>
```

- [ ] **Step 3: Write the failing test**

Create `tests/test_link_jobs.py`:

```python
"""link_competitor_sources handler — fake session + fake client (no DB/network)."""

import uuid
from pathlib import Path

from sqlalchemy import Select
from sqlalchemy.sql.dml import Update

from pricepilot.scheduler.jobs import handle_link_competitor_sources

FIXTURES = Path(__file__).parent / "fixtures"


class FakeLinkSession:
    """Returns canned competitor rows for SELECTs; records UPDATEs."""

    def __init__(self, rows):
        self._rows = rows  # list of (id, name, tenant_id, city)
        self.statements = []
        self.commits = 0

    def execute(self, statement, *args, **kwargs):
        self.statements.append(statement)
        if isinstance(statement, Select):
            return list(self._rows)
        return statement

    def commit(self):
        self.commits += 1


class FakeClient:
    def __init__(self, html):
        self.html = html
        self.urls = []

    def get(self, url):
        self.urls.append(url)
        return self.html

    def close(self):
        pass


def _competitor_updates(session):
    return [s for s in session.statements if isinstance(s, Update) and s.table.name == "competitors"]


def test_link_sets_source_url_for_matched_competitor():
    html = (FIXTURES / "booking_link_ramada.html").read_text(encoding="utf-8")
    comp_id = uuid.uuid4()
    session = FakeLinkSession([(comp_id, "Ramada by Wyndham Sibiu", uuid.uuid4(), "sibiu")])
    client = FakeClient(html)

    result = handle_link_competitor_sources(
        session, {"property_id": str(uuid.uuid4())}, client=client
    )

    assert result["linked"] == 1
    assert result["unlinked"] == 0
    updates = _competitor_updates(session)
    assert len(updates) == 1
    assert updates[0].compile().params["source_url"] == "https://www.booking.com/hotel/ro/ramada-sibiu.html"


def test_link_leaves_unmatched_competitor_unlinked():
    html = (FIXTURES / "booking_link_ramada.html").read_text(encoding="utf-8")
    session = FakeLinkSession([(uuid.uuid4(), "Nonexistent Guesthouse", uuid.uuid4(), "sibiu")])
    client = FakeClient(html)

    result = handle_link_competitor_sources(session, {"property_id": None}, client=client)

    assert result["linked"] == 0
    assert result["unlinked"] == 1
    assert _competitor_updates(session) == []
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `.venv\Scripts\python -m pytest tests/test_link_jobs.py -v`
Expected: FAIL — `ImportError: cannot import name 'handle_link_competitor_sources'`.

- [ ] **Step 5: Implement the handler**

In `src/pricepilot/scheduler/jobs.py`, add imports near the other scraper imports:

```python
from pricepilot.scrapers.booking import BookingScraper
from pricepilot.scrapers.client import PoliteClient, ScraperBlockedError, ScraperFetchError
from pricepilot.scrapers.linker import resolve_competitor_link
from pricepilot.scrapers.matching import CompetitorRef
```

(`PoliteClient` may already be imported; keep a single import line. `select`, `update`, `Competitor`, `Property`, `date`, `timedelta`, `get_settings`, `_parse_uuid`, `enqueue_job` are already imported in this module.)

Add the query helper and handler (place near `handle_discover_competitors`):

```python
#: Link searches use a near-future date only to form a valid Booking URL; the
#: card link (not its price) is what we read, so the exact date is irrelevant.
LINK_SEARCH_LEAD_DAYS = 30


def _competitors_needing_links(session: Session, *, property_id: UUID | None):
    """Rows (id, name, city) for competitors with no link yet, honoring tombstones."""
    query = (
        select(Competitor.id, Competitor.name, Property.city)
        .join(Property, Competitor.property_id == Property.id)
        .where(Competitor.source_url.is_(None), Competitor.excluded_at.is_(None))
    )
    if property_id is not None:
        query = query.where(Competitor.property_id == property_id)
    return list(session.execute(query))


def handle_link_competitor_sources(
    session: Session,
    payload: dict[str, Any],
    *,
    client: Any = None,
) -> dict[str, Any]:
    """Resolve each unlinked competitor to its Booking listing URL (idempotent).

    Scope: ``property_id`` (one property) or null (a sweep over all). Only rows
    with ``source_url IS NULL`` and no ``excluded_at`` are touched, so an
    existing/corrected link is never clobbered and re-runs are safe. A Booking
    block aborts the remaining competitors and is reported. ``client`` is
    injectable for tests; production builds a PoliteClient.
    """
    settings = get_settings()
    property_id = _parse_uuid(payload.get("property_id"))
    rows = _competitors_needing_links(session, property_id=property_id)
    if not rows:
        return {"linked": 0, "unlinked": 0, "note": "no competitors need linking"}

    scraper = BookingScraper(currency=settings.scrape_currency)
    link_date = date.today() + timedelta(days=LINK_SEARCH_LEAD_DAYS)
    owns_client = client is None
    active_client = client if client is not None else PoliteClient()
    linked = unlinked = 0
    blocked = False
    try:
        for competitor_id, name, city in rows:
            plan = scraper.plan_request(f"{name}, {city}", link_date)
            try:
                html = active_client.get(plan.url)
            except ScraperBlockedError:
                blocked = True
                break
            except ScraperFetchError:
                unlinked += 1
                continue
            cards = scraper.parse_listings(html)[: settings.competitor_link_max_results]
            ref = CompetitorRef(id=competitor_id, name=name, source_url=None)
            url = resolve_competitor_link(cards, ref, city, identity_of=scraper.identity_of)
            if url is None:
                unlinked += 1
                continue
            session.execute(
                update(Competitor).where(Competitor.id == competitor_id).values(source_url=url)
            )
            linked += 1
        session.commit()
    finally:
        if owns_client:
            active_client.close()

    return {
        "property_id": str(property_id) if property_id is not None else None,
        "linked": linked,
        "unlinked": unlinked,
        "blocked": blocked,
    }
```

Register it in `HANDLERS`:

```python
    "link_competitor_sources": handle_link_competitor_sources,
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `.venv\Scripts\python -m pytest tests/test_link_jobs.py -v`
Expected: PASS.

- [ ] **Step 7: Update the contracts and `.env.example`**

In `shared/contracts/jobs.md`, add a row to the job-types table:

```markdown
| `link_competitor_sources` | `{"property_id": "<uuid>\|null"}` | Resolve each unlinked competitor (scope: one property, or all when null) to its Booking listing and store the URL in `competitors.source_url`; enqueued after `discover_competitors` and nightly. Idempotent — only fills empty links |
```

Under "Result shapes", add:

```markdown
`link_competitor_sources`:

​```json
{"property_id": "…|null", "linked": 9, "unlinked": 3, "blocked": false}
​```

Only competitors with `source_url IS NULL` and no `excluded_at` are considered;
a Booking block sets `blocked` and stops the run. Unlinked competitors are
retried by the next sweep.
```

Update the setup-chain note (Dashboard section or resolve_place row) to read: `resolve_place → discover_competitors → link_competitor_sources`.

In `shared/contracts/table-ownership.md`, change the `competitors` `source_url` phrase from "auto-discovered competitors have none until the scraper matches them by name" to: "auto-discovered competitors have none until `link_competitor_sources` resolves their Booking listing URL".

In `.env.example`, under the Places/scrape block:

```bash
# Cards considered per competitor when resolving its Booking listing link.
COMPETITOR_LINK_MAX_RESULTS=10
```

- [ ] **Step 8: Run the full suite + lint, then commit**

Run: `.venv\Scripts\python -m pytest -q` then `.venv\Scripts\python -m ruff check src tests`
Expected: PASS / no lint errors.

```bash
git add src/pricepilot/config.py src/pricepilot/scheduler/jobs.py shared/contracts/jobs.md shared/contracts/table-ownership.md .env.example tests/fixtures/booking_link_ramada.html tests/test_link_jobs.py
git commit -m "feat(jobs): add link_competitor_sources to resolve competitor Booking URLs"
```

---

### Task 5: Auto-chaining + nightly sweep

**Files:**
- Modify: `src/pricepilot/scheduler/jobs.py` (`handle_discover_competitors` enqueues the link job)
- Modify: `src/pricepilot/scheduler/main.py` (nightly link sweep)
- Test: `tests/test_place_jobs.py`, `tests/test_scrapers.py` (scheduler wiring)

**Interfaces:**
- Consumes: `enqueue_job` (existing), `handle_link_competitor_sources` (Task 4), `build_scheduler` (existing).

- [ ] **Step 1: Write the failing test for chaining**

Add to `tests/test_place_jobs.py` (reuses the file's `FakeSession`, `FakeNearby`, `make_property`, `make_competitor`, `_inserts_of`, and `PlaceCandidate`):

```python
def test_discover_enqueues_link_job():
    prop = make_property(name="Hotel X", city="sibiu")
    prop.place_id = "ChIJ_self"
    prop.latitude = Decimal("45.79")
    prop.longitude = Decimal("24.15")
    session = FakeSession(prop, existing_competitors=[])
    provider = FakeNearby(
        [PlaceCandidate("ChIJ_a", "Nearby Inn", None, Decimal("45.80"), Decimal("24.16"), Decimal("4.2"), 120)]
    )

    handle_discover_competitors(session, {"property_id": str(prop.id)}, provider=provider)

    link_jobs = [
        i for i in _inserts_of(session, "jobs")
        if i.compile().params["type"] == "link_competitor_sources"
    ]
    assert len(link_jobs) == 1
    assert link_jobs[0].compile().params["payload"] == {"property_id": str(prop.id)}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv\Scripts\python -m pytest tests/test_place_jobs.py::test_discover_enqueues_link_job -v`
Expected: FAIL — no `link_competitor_sources` job insert.

- [ ] **Step 3: Chain the link job from discovery**

In `src/pricepilot/scheduler/jobs.py`, in `handle_discover_competitors`, after the existing `session.commit()` (end of the handler) and before `return`:

```python
    session.commit()
    enqueue_job(session, "link_competitor_sources", {"property_id": str(prop.id)})
    return {
        "property_id": str(prop.id), "discovered": discovered,
        "skipped_excluded": skipped_excluded, "capped": capped,
    }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `.venv\Scripts\python -m pytest tests/test_place_jobs.py -v`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the nightly sweep wiring**

Add to `tests/test_scrapers.py` (or `tests/test_scraper_cli.py`; pure, no DB):

```python
from pricepilot.scheduler.main import build_scheduler


def test_scheduler_registers_link_sweep():
    names = {job.name for job in build_scheduler().get_jobs()}
    assert "link" in names
```

- [ ] **Step 6: Run it to verify it fails**

Run: `.venv\Scripts\python -m pytest tests/test_scrapers.py::test_scheduler_registers_link_sweep -v`
Expected: FAIL — no job named "link".

- [ ] **Step 7: Add the nightly link sweep**

In `src/pricepilot/scheduler/main.py`, add the enqueue function (near `enqueue_nightly_scrape`):

```python
def enqueue_nightly_link() -> None:
    _enqueue("link_competitor_sources", {"property_id": None})
```

Register it in `build_scheduler` just before the scrape (so fresh links exist when the scrape runs):

```python
    scheduler.add_job(enqueue_nightly_link, CronTrigger(hour=3, minute=45), name="link")
    scheduler.add_job(enqueue_nightly_scrape, CronTrigger(hour=4, minute=0), name="scrape")
```

Update the startup log line:

```python
        logger.info("APScheduler started: ingest 02:00, link 03:45, scrape 04:00, engine 05:00 (UTC)")
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `.venv\Scripts\python -m pytest tests/test_scrapers.py tests/test_place_jobs.py -v`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/pricepilot/scheduler/jobs.py src/pricepilot/scheduler/main.py tests/test_place_jobs.py tests/test_scrapers.py
git commit -m "feat(scheduler): chain competitor linking after discovery + nightly sweep"
```

---

### Task 6: Adaptive pagination for coverage

**Files:**
- Modify: `src/pricepilot/scrapers/booking.py` (`build_search_url` offset, `plan_request` page → offset)
- Modify: `src/pricepilot/scrapers/airbnb.py` (signature parity)
- Modify: `src/pricepilot/scrapers/orchestrator.py` (`collect_source_observations` pages adaptively; `scrape_city` threads `max_pages`)
- Modify: `src/pricepilot/scheduler/jobs.py` (`handle_scrape_competitor_rates` passes `settings.scrape_max_pages`)
- Modify: `src/pricepilot/config.py` (`scrape_max_pages`), `.env.example`
- Test: `tests/test_scrapers.py`, `tests/test_scrape_orchestrator.py`

**Interfaces:**
- Consumes: `match_listings(..., identity_of=…)` (Task 2), `scraper.plan_request(city, date, page=…)`.
- Produces: `build_search_url(city, stay_date, *, currency="RON", offset=0)`; `collect_source_observations(..., max_pages=1)`; `scrape_city(..., max_pages=1)`.

- [ ] **Step 1: Write the failing test for offset URLs**

Add to `tests/test_scrapers.py`:

```python
from datetime import date

from pricepilot.scrapers.booking import BookingScraper, build_search_url


def test_build_search_url_omits_offset_on_first_page():
    url = build_search_url("sibiu", date(2026, 7, 10))
    assert "offset" not in url


def test_plan_request_page_maps_to_offset():
    scraper = BookingScraper(currency="RON")
    url = scraper.plan_request("sibiu", date(2026, 7, 10), page=2).url
    assert "offset=50" in url  # page 2 * 25 per page
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv\Scripts\python -m pytest tests/test_scrapers.py -k offset -v`
Expected: FAIL — `plan_request` got unexpected keyword `page` / no `offset` handling.

- [ ] **Step 3: Add offset to the Booking URL + page→offset mapping**

In `src/pricepilot/scrapers/booking.py`, update `build_search_url`:

```python
def build_search_url(
    city: str, stay_date: date, *, currency: str = "RON", offset: int = 0
) -> str:
    """Search-results URL for one night (checkin=stay date, checkout=+1)."""
    params = {
        "ss": city,
        "checkin": stay_date.isoformat(),
        "checkout": (stay_date + timedelta(days=1)).isoformat(),
        "group_adults": 2,
        "no_rooms": 1,
        "group_children": 0,
        "selected_currency": currency,
        "lang": "en-us",
    }
    if offset:
        params["offset"] = offset
    return f"{BOOKING_SEARCH_URL}?{urlencode(params)}"
```

Update `BookingScraper.plan_request`:

```python
    def plan_request(self, city: str, stay_date: date, *, page: int = 0) -> PlannedRequest:
        return PlannedRequest(
            url=build_search_url(city, stay_date, currency=self.currency, offset=page * _PAGE_SIZE),
            stay_date=stay_date,
        )
```

In `src/pricepilot/scrapers/airbnb.py`, update the signature for parity (still raises):

```python
    def plan_request(self, city: str, stay_date: date, *, page: int = 0) -> PlannedRequest:
        raise NotImplementedError(_NOT_IMPLEMENTED)
```

- [ ] **Step 4: Run to verify the URL tests pass**

Run: `.venv\Scripts\python -m pytest tests/test_scrapers.py -k offset -v`
Expected: PASS.

- [ ] **Step 5: Write the failing test for adaptive pagination**

Add to `tests/test_scrape_orchestrator.py`:

```python
from datetime import date
from decimal import Decimal

from pricepilot.scrapers.base import ListingRate, PlannedRequest, SearchScraper
from pricepilot.scrapers.matching import CompetitorRef
from pricepilot.scrapers.orchestrator import collect_source_observations


class TwoPageScraper(SearchScraper):
    """Page 0 lists hotel A only; page 1 adds hotel B. Records pages fetched."""

    name = "twopage"

    def __init__(self, currency="RON"):
        super().__init__(currency=currency)
        self.pages_requested = []

    def plan_request(self, city, stay_date, *, page=0):
        self.pages_requested.append(page)
        return PlannedRequest(url=f"http://test/{page}", stay_date=stay_date)

    def parse_listings(self, html):
        page = html.rsplit("/", 1)[-1]
        if page == "0":
            return [ListingRate("Hotel A", Decimal("300"), "RON", "http://x/hotel/ro/a.html")]
        return [ListingRate("Hotel B", Decimal("400"), "RON", "http://x/hotel/ro/b.html")]

    def identity_of(self, url):
        from pricepilot.scrapers.booking import booking_slug
        return booking_slug(url)


class DictClient:
    def __init__(self, pages):
        self.pages = pages

    def get(self, url):
        return url  # scraper.parse_listings keys off the trailing page number


def test_pagination_stops_early_when_all_matched():
    scraper = TwoPageScraper()
    competitors = [CompetitorRef(id=__import__("uuid").uuid4(), name="Hotel A")]
    outcome = collect_source_observations(
        scraper, DictClient({}), city="sibiu", competitors=competitors,
        stay_dates=[date(2026, 7, 10)], expected_currency="RON", max_pages=3,
    )
    assert scraper.pages_requested == [0]  # matched on page 0, no further paging
    assert len(outcome.observations) == 1


def test_pagination_escalates_until_match():
    scraper = TwoPageScraper()
    competitors = [
        CompetitorRef(id=__import__("uuid").uuid4(), name="Hotel A"),
        CompetitorRef(id=__import__("uuid").uuid4(), name="Hotel B"),
    ]
    outcome = collect_source_observations(
        scraper, DictClient({}), city="sibiu", competitors=competitors,
        stay_dates=[date(2026, 7, 10)], expected_currency="RON", max_pages=3,
    )
    assert scraper.pages_requested == [0, 1]  # needed page 1 to find Hotel B
    assert len(outcome.observations) == 2
```

- [ ] **Step 6: Run to verify it fails**

Run: `.venv\Scripts\python -m pytest tests/test_scrape_orchestrator.py -k pagination -v`
Expected: FAIL — `collect_source_observations` got unexpected keyword `max_pages`.

- [ ] **Step 7: Implement adaptive pagination in the orchestrator**

In `src/pricepilot/scrapers/orchestrator.py`, add `max_pages` to `collect_source_observations` and replace its per-date loop body. Full replacement of the function signature and loop:

```python
def collect_source_observations(
    scraper: SearchScraper,
    client: SupportsGet,
    *,
    city: str,
    competitors: Sequence[CompetitorRef],
    stay_dates: Sequence[date],
    expected_currency: str,
    max_pages: int = 1,
) -> SourceOutcome:
    """Fetch/parse/match the whole window for one source. No DB access.

    Per stay date, fetch result pages only until every in-scope competitor is
    matched or ``max_pages`` is reached (adaptive: usually one request). A block
    aborts the remaining dates; a transient failure skips only its date. Matched
    observations in a different currency than requested are dropped with a note.
    """
    outcome = SourceOutcome()
    matched_ever: set[Any] = set()
    currency_mismatch_dates: dict[tuple[str, str], int] = {}

    for index, stay_date in enumerate(stay_dates):
        listings: list[Any] = []
        matches: dict[Any, Any] = {}
        fetched = False
        block_issue: str | None = None

        for page in range(max_pages):
            plan = scraper.plan_request(city, stay_date, page=page)
            try:
                html = client.get(plan.url)
            except ScraperBlockedError as exc:
                remaining = len(stay_dates) - index
                block_issue = (
                    f"{stay_date}: blocked ({exc}); aborted the remaining {remaining - 1} dates"
                )
                break
            except ScraperFetchError as exc:
                if page == 0:
                    outcome.dates_failed += 1
                    outcome.issues.append(f"{stay_date}: {exc}")
                else:
                    outcome.issues.append(f"{stay_date} page {page + 1}: {exc}")
                break

            fetched = True
            listings.extend(scraper.parse_listings(html))
            matches = match_listings(listings, competitors, city, identity_of=scraper.identity_of)
            if len(matches) >= len(competitors):
                break  # everyone found; stop paging

        if block_issue is not None:
            outcome.blocked = True
            outcome.dates_failed += len(stay_dates) - index
            outcome.issues.append(block_issue)
            break

        if not fetched:
            continue

        outcome.dates_fetched += 1
        for competitor_id, listing in matches.items():
            matched_ever.add(competitor_id)
            if listing.currency != expected_currency:
                key = (listing.name, listing.currency)
                currency_mismatch_dates[key] = currency_mismatch_dates.get(key, 0) + 1
                continue
            outcome.observations.append(
                RateObservation(
                    competitor_id=competitor_id,
                    stay_date=stay_date,
                    price=listing.price,
                    currency=listing.currency,
                )
            )

    for (name, currency), count in sorted(currency_mismatch_dates.items()):
        outcome.issues.append(
            f"currency mismatch {currency} for {name!r} on {count} "
            f"date{'s' if count != 1 else ''}; observations dropped"
        )

    if outcome.dates_fetched:
        outcome.unmatched = [
            competitor.name
            for competitor in competitors
            if competitor.id not in matched_ever
        ]
    return outcome
```

Thread `max_pages` through `scrape_city` — add the parameter and pass it down:

```python
def scrape_city(
    session: Session,
    client: SupportsGet,
    *,
    city: str,
    competitors: Sequence[CompetitorRef],
    stay_dates: Sequence[date],
    sources: Sequence[str],
    currency: str,
    max_pages: int = 1,
) -> dict[str, Any]:
```

and in its call to `collect_source_observations`:

```python
        outcome = collect_source_observations(
            scraper,
            client,
            city=city,
            competitors=competitors,
            stay_dates=stay_dates,
            expected_currency=currency,
            max_pages=max_pages,
        )
```

- [ ] **Step 8: Run to verify the pagination tests pass**

Run: `.venv\Scripts\python -m pytest tests/test_scrape_orchestrator.py -v`
Expected: PASS (existing single-page tests still green — default `max_pages=1`).

- [ ] **Step 9: Wire config into the scrape job**

In `src/pricepilot/config.py`, next to `competitor_link_max_results`:

```python
    scrape_max_pages: int = 2               # city-search pages per date (adaptive; 1 = strict ADR-0004)
```

In `src/pricepilot/scheduler/jobs.py`, in `handle_scrape_competitor_rates`, pass it to `scrape_city`:

```python
            city_result = scrape_city(
                session,
                active_client,
                city=city,
                competitors=scoped_competitors[city],
                stay_dates=stay_dates,
                sources=sources,
                currency=currency,
                max_pages=settings.scrape_max_pages,
            )
```

In `.env.example`, under the scrape block:

```bash
# Max Booking search pages fetched per stay date (adaptive: stops when all
# competitors are matched). 1 = strict one-request-per-date (ADR 0004).
SCRAPE_MAX_PAGES=2
```

- [ ] **Step 10: Run the full suite + lint**

Run: `.venv\Scripts\python -m pytest -q` then `.venv\Scripts\python -m ruff check src tests`
Expected: PASS / no lint errors.

- [ ] **Step 11: Commit**

```bash
git add src/pricepilot/scrapers/booking.py src/pricepilot/scrapers/airbnb.py src/pricepilot/scrapers/orchestrator.py src/pricepilot/scheduler/jobs.py src/pricepilot/config.py .env.example tests/test_scrapers.py tests/test_scrape_orchestrator.py
git commit -m "feat(scrapers): adaptive city-search pagination until all competitors matched"
```

---

## Post-implementation: backfill & verify

- [ ] **Backfill links for already-discovered competitors** (one-off; DB up):

```bash
docker compose exec -T db psql -U pricepilot -d pricepilot -c \
  "insert into jobs (id, type, payload, status, created_at) values (gen_random_uuid(), 'link_competitor_sources', '{\"property_id\": null}', 'queued', now());"
```

Then watch `docker compose logs -f dataplane` for `link_competitor_sources … succeeded` and confirm links landed:

```bash
docker compose exec -T db psql -U pricepilot -d pricepilot -c \
  "select name, source_url from competitors where source_url is not null order by name limit 20;"
```

- [ ] **Trigger a scrape and confirm rates attach** to the newly linked competitors (rates_written > 0; `unmatched` shrinks).

---

## Self-review notes

- **Spec coverage:** Booking identity/slug (Task 1); link store in `source_url` (Task 4); slug-exact recurring match + name fallback (Task 2); one-time name-scoped link resolver reusing `match_listings` (Tasks 3–4); adaptive pagination (Task 6); auto-chain + nightly sweep (Task 5); jobs.md + table-ownership updates, no schema change, config knobs (Tasks 4, 6); `recommendation-factors.md` untouched. Non-goals (UI removal, engine naming, owner-correction UI, coord matching, hotel-page parser, paid API) intentionally excluded.
- **Type consistency:** `identity_of` signature identical across `base.py`, `BookingScraper`, `match_listings`, `resolve_competitor_link`, and the handler. `plan_request(..., *, page=0)` consistent across base/Booking/Airbnb and both orchestrator + linker call sites (linker calls `plan_request(query, date)` → page defaults 0). `source_url` is the single written column throughout.
- **Idempotency/tenant isolation:** linker only fills `NULL` links, scoped by `property_id` when given; writes only `competitors.source_url` on existing tenant-owned rows.
