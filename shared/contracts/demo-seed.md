# Demo Seed Contract

Fixed UUIDs for the demo/dev dataset so the backend seeder (backend-owned tables) and the
dataplane seeder (dataplane-owned tables) produce one coherent world without talking to
each other. Both seeders MUST be idempotent (safe to run repeatedly).

**Dev/demo only.** Never run either seeder against production data.

## Identities

| Entity | UUID | Notes |
|---|---|---|
| Tenant "Pensiunea Demo SRL" | `11111111-1111-4111-8111-111111111111` | subscription_plan `demo` |
| User `demo@pricepilot.local` | `22222222-2222-4222-8222-222222222222` | password `Demo1234!` (hashed at seed time), role `owner` |
| Property "Pensiunea Piața Mică" (Sibiu) | `33333333-3333-4333-8333-333333333333` | city stored as `sibiu` (lowercase key) |
| RoomType "Cameră dublă" | `44444444-4444-4444-8444-444444444444` | capacity 2, base 350.00 RON, current 350.00 RON |
| RoomType "Apartament" | `55555555-5555-4555-8555-555555555555` | capacity 4, base 520.00 RON, current 520.00 RON |
| Competitor "Hotel Ramada Sibiu" | `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` | mid/upper market |
| Competitor "Hotel Împăratul Romanilor" | `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb` | central classic |
| Competitor "Casa Luxemburg" | `cccccccc-cccc-4ccc-8ccc-cccccccccccc` | boutique guesthouse |

## Responsibilities

- **Backend** (`Demo__SeedOnStartup=true`, Development only): tenants, users, properties,
  room_types, competitors — exactly the rows above.
- **Dataplane** (`python -m pricepilot.demo.seed`): scraped_rates for the three competitors
  (next 120 days, plausible prices with event-aware bumps around seeded events), one
  succeeded scrape_run, events for `sibiu` (via the static source), demand_signals optional.

City key convention: `city` values are lowercase ASCII slugs (`sibiu`), display names live
in the UI layer.
