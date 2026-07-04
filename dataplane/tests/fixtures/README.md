# Scraper fixtures

Scraper tests use saved HTML only — **never live sites** (repo hard rule #4).

When a source changes markup, re-capture a page here (strip anything
sensitive/huge) and update the corresponding parser in
`src/pricepilot/scrapers/` in the same commit.

| File | Source | Parser |
|---|---|---|
| `booking_sample.html` | Booking.com rates page (hand-crafted minimal capture) | `pricepilot.scrapers.booking.parse_rates` |
