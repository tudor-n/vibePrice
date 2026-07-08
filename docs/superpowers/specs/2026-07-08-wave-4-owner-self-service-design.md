# Wave 4 — Owner Self-Service (property, rooms, prices, competitors, accept loop)

**Date:** 2026-07-08
**Status:** Approved (autonomous session; standing free-reign mandate)
**Depends on:** wave 3 (`2026-07-08-wave-3-market-data-and-watercolor-ui-design.md`)

## Goal

A real owner (not the demo seeder) can run PricePilot end-to-end: create their
property, define room types with prices, track competitors, and have an accepted
recommendation actually take effect. Today the Settings page says prices are "managed
by your onboarding contact", room types have no API at all, and accepting a
recommendation only flips a status — the engine keeps reasoning from the stale
`current_price`.

## Scope decision

Chosen over own-bookings CSV import (valuable, but useless to owners who cannot even
set prices — it becomes wave 5) and over signup/tenant provisioning (manual tenant
creation is fine pre-launch; billing questions are premature). One subsystem: owner
self-service management + closing the accept loop.

**In:**
1. Room-type API: create + edit (no delete — YAGNI, recommendations/history reference it).
2. Accept loop: accepting a recommendation sets its room type's `current_price` to the
   recommended price, atomically with the status flip.
3. Competitor delete API (add already exists), with rate history cleaned by the DB.
4. Web: Settings becomes the management surface (create property — endpoint exists;
   room-type create/edit forms with prices; per-property competitor add/remove).
   Watercolor styling, existing token system.

**Out (unchanged):** signup/tenant CRUD, room-type delete, own-bookings CSV (wave 5),
user management, base-price bulk tools, i18n.

## API design (openapi.yaml in the same commits)

| Endpoint | Behavior |
|---|---|
| `POST /properties/{propertyId}/room-types` | Create. Body `RoomTypeCreate{name, capacity, basePrice, currentPrice?, currency?}`; `currentPrice` defaults to `basePrice`; `currency` defaults `RON`, **immutable after create** (changing it mid-history would corrupt comparisons). 201 → `RoomType`. 404 when the property is not the caller's (tenant filter). |
| `PATCH /room-types/{roomTypeId}` | Edit `name`, `capacity`, `basePrice`, `currentPrice` (any subset; `RoomTypeUpdate`). Currency not editable. 200 → `RoomType`; 404 via tenant filter; 400 on non-positive prices/capacity. |
| `DELETE /competitors/{competitorId}` | Untrack. 204; 404 via tenant filter. The competitor's `scraped_rates` go with it via **DB cascade** (see schema). |
| `POST /recommendations/{id}/status` (existing) | On `accepted`: also set the room type's `current_price = recommended_price` in the same transaction. On `dismissed`: unchanged. Response unchanged. |

Validation: prices must be `> 0` and `numeric(10,2)`-representable; capacity `>= 1`;
names non-blank. All handlers resolve entities through the tenant-filtered context
(404 for other tenants' ids — never 403).

## Schema change (one PR, both runtimes + contract)

`scraped_rates.competitor_id` FK gains `ON DELETE CASCADE` (EF migration). Rationale:
competitor rows are tenant-owned; each tenant's observations hang off their own
competitor row, so untracking one removes only that tenant's copy. The **database**
does the delete, so the dataplane-writes-`scraped_rates` ownership rule stays intact —
documented in `table-ownership.md`. SQLAlchemy mapping annotated (`ondelete="CASCADE"`;
the schema-sync check compares columns, not FK rules — no drift risk).

## Accept-loop semantics (the "prices are the product" fix)

`RecommendationQueries.UpdateStatusAsync`, on a pending→accepted transition only:
load the room type through the filtered context, set `current_price =
recommendation.recommended_price`, save with the status flip in one transaction.
Dismissals and repeat/invalid transitions (guarded by `TryTransitionTo`) never touch
prices. The engine picks up the new `current_price` on its next run and the next
nightly recompute reasons from what the owner actually charges.
`table-ownership.md` note: the backend's `room_types` write-ownership now explicitly
includes this accept-time price update.

Trade-off accepted: v1 has no channel push, so "accepted" means "I will set this on my
channels" — PricePilot optimistically treats it as done; the value is honest
`current_price`-relative reasoning (competitor gaps, future deltas). Documented in the
UI copy ("We'll treat this as your new price").

## Web design (Settings page becomes real; watercolor system)

- **Add property** card: name, city (lowercase slug hint), optional address → POST,
  then it appears in the property switcher (PropertyContext refetch).
- **Per property**: room-type table gains an "Edit" affordance per row (inline form:
  name, sleeps, base price, current price) and an "Add room type" form (plus currency,
  default RON, create-only). Money inputs are plain decimal inputs with the currency
  shown beside them — never computed client-side, sent as JSON numbers.
- **Competitors** management moves onto the Competitors page: "Track a competitor"
  form (name + OTA listing URL) and an "Untrack" button per row (confirm dialog; copy
  explains rate history for it is removed). Names should match the OTA listing —
  helper text points at the unmatched-competitors signal from scrape runs.
- **Recommendation card**: accept button copy gains "We'll treat this as your new
  price."; on success, invalidate properties + recommendations so the switcher and
  cards show the new current price.
- Dev-tenant panel on Settings stays (dev tooling relies on it).
- All forms: label + inline validation errors + pending/disabled states + success
  feedback; states via `States.tsx`; ≥44px targets; existing tokens only.

## Testing

- Backend (WebApplicationFactory + SQLite, mirroring `JobPayloadValidationTests`):
  room-type create (defaults, 404 foreign property, 400 bad values), patch (subset
  updates, currency immutability, 404 foreign), competitor delete (204/404, cascade
  verified against the real FK in the Postgres integration migration test is not
  feasible on SQLite — assert EF cascade config instead), accept sets current_price
  (and dismissed/double-accept do not).
- Dataplane: schema-sync stays green (mapping annotation only); no behavior change.
- Web: form flows with mocked fetch (create property/room type appears, patch edits,
  competitor untrack with confirm, accept invalidates and updates), all suites green.
- Contract: openapi.yaml + table-ownership.md updated with the code.

## Risks

| Risk | Mitigation |
|---|---|
| Accept silently changing prices surprises owners | explicit button copy + card already shows old→new price |
| Cascade wipes history the owner wanted | confirm dialog states it plainly; only that tenant's copy is affected |
| Currency mix-ups on create | default RON, create-only, displayed beside every price input |
