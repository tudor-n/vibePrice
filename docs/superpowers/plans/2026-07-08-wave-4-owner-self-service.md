# Wave 4 Implementation Plan — Owner Self-Service

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners manage property, room types, prices, and competitors themselves, and an accepted recommendation becomes the room's real `current_price`.

**Architecture:** Backend gains room-type create/edit endpoints, competitor delete (rate history removed by a new DB `ON DELETE CASCADE`), and an accept-time `current_price` update inside `UpdateStatusAsync` — all through the tenant-filtered context. The web Settings/Competitors pages become real management surfaces on the existing watercolor token system. Contracts (`openapi.yaml`, `table-ownership.md`) move with the code.

**Tech Stack:** ASP.NET Core 9 minimal APIs + EF Core (xUnit, WebApplicationFactory + SQLite), SQLAlchemy mapping annotation only, React 19 + react-query (Vitest/RTL).

**Spec:** `docs/superpowers/specs/2026-07-08-wave-4-owner-self-service-design.md`

## Global Constraints

- Money `decimal`/JSON numbers only; prices `> 0`, `numeric(10,2)`; currency `char(3)`, default `RON`, **create-only** on room types.
- Every lookup by id goes through the tenant-filtered context; foreign ids → 404, never 403.
- Schema change (cascade) = EF migration + SQLAlchemy annotation + `table-ownership.md` in the same commit.
- openapi.yaml updated in the same commit as each endpoint change; web `types.ts` mirrors it.
- Backend: `dotnet build` (warnings = errors) + `dotnet test`. Dataplane: `pytest` + `ruff`. Web: `npm test -- --run`, `typecheck`, `build`.
- Conventional commits; TDD per task.

---

### Task W4-1: Room-type create + edit API

**Files:**
- Modify: `backend/src/PricePilot.Application/IPropertyService.cs`, `Dtos.cs` (or wherever `RoomTypeDto` lives — add `RoomTypeCreateDto`, `RoomTypeUpdateDto`)
- Modify: `backend/src/PricePilot.Infrastructure/Services/PropertyService.cs`
- Modify: `backend/src/PricePilot.Api/Endpoints/PropertyEndpoints.cs`
- Modify: `shared/contracts/openapi.yaml`
- Test: `backend/tests/PricePilot.UnitTests/RoomTypeEndpointTests.cs` (WebApplicationFactory + SQLite, mirror `JobPayloadValidationTests` setup)

**Interfaces (later tasks rely on):**
```csharp
public sealed record RoomTypeCreateDto(string Name, int Capacity, decimal BasePrice, decimal? CurrentPrice, string? Currency);
public sealed record RoomTypeUpdateDto(string? Name, int? Capacity, decimal? BasePrice, decimal? CurrentPrice); // null = unchanged
// IPropertyService:
Task<RoomTypeDto?> AddRoomTypeAsync(Guid propertyId, RoomTypeCreateDto dto, CancellationToken ct);   // null = property not caller's
Task<RoomTypeDto?> UpdateRoomTypeAsync(Guid roomTypeId, RoomTypeUpdateDto dto, CancellationToken ct); // null = room type not caller's
```
Endpoints: `POST /properties/{propertyId}/room-types` → 201 + RoomType | 404 | 400;
`PATCH /room-types/{roomTypeId}` → 200 + RoomType | 404 | 400. Validation (endpoint
layer, before service): Name non-blank when present/required; Capacity ≥ 1; prices > 0
and `decimal.Round(v, 2) == v`; Currency exactly 3 letters when given (default "RON").
`CurrentPrice` defaults to `BasePrice` on create. `TenantId` comes from `ITenantContext`
(never the body). PATCH ignores currency by type design (no field).

- [ ] W4-1.1 Failing tests: create with defaults (201, currentPrice == basePrice, currency RON, appears in GET /properties payload); create on foreign property → 404; capacity 0 → 400; price ≤ 0 → 400; price with 3 decimals → 400; bad currency ("RONI") → 400; patch subset (only basePrice) leaves others; patch foreign → 404; patch blank name → 400.
- [ ] W4-1.2 Implement DTOs + service methods + endpoints + openapi (`RoomTypeCreate`, `RoomTypeUpdate` schemas + the two paths, 400/404 documented).
- [ ] W4-1.3 `dotnet build && dotnet test` green (0 warnings). Commit `feat(api): room-type create and edit endpoints`.

### Task W4-2: Accept sets the room's current price

**Files:**
- Modify: `backend/src/PricePilot.Infrastructure/Services/RecommendationQueries.cs:42-62`
- Modify: `shared/contracts/table-ownership.md` (room_types note), `shared/contracts/openapi.yaml` (status POST description sentence)
- Test: `backend/tests/PricePilot.UnitTests/AcceptUpdatesPriceTests.cs`

In `UpdateStatusAsync`, after `TryTransitionTo` succeeds and only when
`newStatus == RecommendationStatus.Accepted`: load the room type through the filtered
context (`db.RoomTypes.FirstOrDefaultAsync(rt => rt.Id == recommendation.RoomTypeId)`),
set `CurrentPrice = recommendation.RecommendedPrice`, then the existing single
`SaveChangesAsync` persists both (one transaction). Pinned edge: if the room-type row
is somehow gone, the status update still proceeds (the recommendation stays
decidable) — just a null check, nothing more; room-type delete does not exist, so the
branch is defensive only.

- [ ] W4-2.1 Failing tests: accept → room_types.current_price == recommended_price AND status accepted (same SaveChanges); dismiss → price untouched; second accept (InvalidTransition) → price not re-applied (set price manually between calls to prove it); foreign recommendation → NotFound, no price change.
- [ ] W4-2.2 Implement + contract notes. `dotnet test` green. Commit `feat(api): accepting a recommendation updates the room's current price`.

### Task W4-3: Competitor delete + scraped_rates cascade

**Files:**
- Modify: `backend/src/PricePilot.Infrastructure/AppDbContext.cs` (ScrapedRate FK → `OnDelete(DeleteBehavior.Cascade)`)
- Create: EF migration `ScrapedRatesCascadeOnCompetitorDelete` (`dotnet tool run dotnet-ef migrations add ...` per backend/CLAUDE.md)
- Modify: `backend/src/PricePilot.Application/IPropertyService.cs` (+`Task<bool> RemoveCompetitorAsync(Guid competitorId, CancellationToken ct)` — false = not caller's), `PropertyService.cs`, `PropertyEndpoints.cs` (`DELETE /competitors/{competitorId}` → 204 | 404)
- Modify: `shared/contracts/openapi.yaml`, `shared/contracts/table-ownership.md` (cascade note under scraped_rates: "rows are removed by DB cascade when their competitor row is deleted — the dataplane write-ownership rule is untouched"), `dataplane/src/pricepilot/db/tables.py` (`ForeignKey("competitors.id", ondelete="CASCADE")` annotation)
- Test: `backend/tests/PricePilot.UnitTests/CompetitorDeleteTests.cs`; dataplane schema-sync must stay green

- [ ] W4-3.1 Failing tests: delete own competitor → 204, row gone, its scraped_rates rows gone (SQLite enforces FKs — seed rates in the test context first); foreign competitor → 404, row + rates intact; second delete → 404.
- [ ] W4-3.2 Implement FK change + migration + service + endpoint + contracts + SQLAlchemy annotation.
- [ ] W4-3.3 `dotnet test` green; apply migration to dev DB (`dotnet tool run dotnet-ef database update ... --connection "Host=localhost;..."`); run dataplane `pytest` (schema-sync + full suite) green. Commit `feat(api): untrack competitor - delete endpoint + scraped_rates cascade`.

### Task W4-4: Web management UI (dispatched to implementer agent; web/ only)

Read first: `web/CLAUDE.md`, this plan, the spec's "Web design" section,
`shared/contracts/openapi.yaml` (RoomTypeCreate/RoomTypeUpdate/CompetitorCreate + new
endpoints), existing `SettingsPage.tsx`, `CompetitorsPage.tsx`, `hooks.ts`, `types.ts`,
`global.css` tokens.

Deliverables:
1. `types.ts`: `RoomTypeCreate`, `RoomTypeUpdate` mirroring openapi; hooks:
   `useCreateProperty`, `useCreateRoomType`, `useUpdateRoomType`, `useAddCompetitor`,
   `useRemoveCompetitor` (react-query mutations invalidating `['properties']` /
   `['competitors']` as appropriate).
2. Settings: "Add property" card (name, city, optional address; success switches
   PropertyContext to it); per-property room-type table with inline edit (name, sleeps,
   base price, current price — decimal inputs, currency displayed read-only beside
   them) + "Add room type" form (currency select create-only, default RON). Client
   validation mirrors the API (non-blank, ≥1, > 0, ≤2 decimals) with inline errors;
   server 400 surfaced via ErrorState.
3. Competitors page: "Track a competitor" form (name + sourceUrl with helper text
   "use the exact OTA listing name — unmatched names are reported after each scrape");
   per-row "Untrack" with `window.confirm` copy stating rate history for it is removed.
4. RecommendationCard accept button subline "We'll treat this as your new price.";
   accept success invalidates `['properties']` too (current price shown elsewhere).
5. Tests for every flow with mocked fetch (create/edit/untrack/validation/error paths);
   all suites + typecheck + build green; no new deps; watercolor tokens only; a11y
   rules (labels, ≥44px, visible focus, states for loading/error/empty).

### Task W4-5: Verification + docs closeout

- [ ] Full suites: backend, dataplane (with dev DB), web. Compose config still valid.
- [ ] Manual API smoke against the dev stack: create room type via curl (dev X-Tenant-Id), accept a recommendation, verify `room_types.current_price` changed in psql.
- [ ] Code-reviewer agent on the wave-4 diff; fix findings.
- [ ] `docs/roadmap.md` wave-4 section + memory update. Commit.

## Execution notes

Order: W4-1 → W4-2 → W4-3 inline (backend, one commit each); W4-4 dispatched to the
implementer agent as soon as W4-1's openapi lands (it codes against the contract);
W4-5 last. The dev DB migration in W4-3 must be applied before dataplane integration
tests run.
