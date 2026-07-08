# Scraper fixtures

Scraper tests use saved HTML/JSON only — **never live sites** (repo hard rule #4).

## Re-capture loop (when a source changes markup)

1. Capture the real page with the same client the scheduler uses (politeness,
   UA, proxy all apply):

   ```powershell
   .venv\Scripts\python -m pricepilot.scrapers.capture booking --city sibiu `
     --out tests/fixtures/booking_search_sibiu_live.html
   ```

   The capture command immediately re-parses what it saved and prints the
   listing count — zero listings means the selectors are stale.
2. Trim the capture to a handful of representative cards (keep the edge cases:
   sold-out card, NBSP prices, diacritics names, a taxes line), strip scripts
   and anything sensitive/huge, and replace the fixture below.
3. Fix the parser in `src/pricepilot/scrapers/` in the same commit until
   `pytest tests/test_scrapers.py` is green again.

| File | Source | Parser |
|---|---|---|
| `booking_search_sibiu.html` | Booking.com search-results page (hand-crafted to the current `data-testid` card markup) | `pricepilot.scrapers.booking.parse_listings` |
| `open_meteo_sibiu.json` | Open-Meteo daily forecast API response | `pricepilot.ingest.weather.parse_forecast` |
