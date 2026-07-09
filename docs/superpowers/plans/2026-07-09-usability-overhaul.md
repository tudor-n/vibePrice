# Usability Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A non-technical owner goes from nothing to their first real price recommendation through a guided full-screen wizard; every background job is visible (never an infinite spinner); and all copy speaks one plain, human voice.

**Architecture:** Mostly `web/` (React 19 + react-query), one small backend endpoint (room-type create), and **no dataplane changes** — the wizard orchestrates jobs that already exist (`resolve_place`, `discover_competitors`, `scrape.competitor_rates`, `ingest.events`, `engine.generate_recommendations`). New reusable web primitives — `AsyncStatus`, `Explainer`, `PlacePicker` — are consumed by the wizard and folded back into the existing pages.

**Tech Stack:** ASP.NET Core 9 minimal APIs + EF Core (xUnit, WebApplicationFactory + SQLite); React 19 + react-query 5 + react-router 7 (Vitest + RTL, mocked `fetch`, fake timers); plain CSS watercolor tokens (`web/src/styles/global.css`).

**Spec:** `docs/superpowers/specs/2026-07-09-usability-overhaul-design.md`

## Global Constraints

- Money is `decimal`/JSON number; prices `> 0`, `numeric(10,2)`; currency `char(3)`, default `RON`. Coordinates never float in C#. Web never computes money (haversine distance is not money and is allowed).
- Backend: every lookup by id goes through the tenant-filtered context; foreign/absent id → **404, never 403**. New writes set `TenantId` from `ITenantContext`, never the body. `openapi.yaml` moves in the same commit as any endpoint change; `web/src/api/types.ts` mirrors it.
- Web: **react-query for ALL server state — no `useEffect` fetching, ever.** New endpoints become hooks in `src/api/hooks.ts`; pages consume hooks only. Every page handles loading / error / empty. Watercolor tokens only — extend tokens in `global.css`, never inline hex. No new dependencies.
- a11y (users are older, non-technical): ≥16px body, real `<label>`s on every control, visible focus, ≥44px touch targets, `aria-live="polite"` on status regions, honor `prefers-reduced-motion`.
- The wizard **never dead-ends**: every async step offers Try again / Keep working in the background / Skip. It **resumes on reload** from real server state — no progress kept only in component state.
- Copy is English (i18n is a later concern). One consistent second-person voice.
- Backend `dotnet build` (warnings = errors) + `dotnet test`. Web `npm test -- --run`, `npm run typecheck`, `npm run build`. Conventional commits; TDD per task.

## File Structure

**Backend (C#)** — one endpoint:
- Modify: `src/PricePilot.Application/Dtos.cs` (add `RoomTypeCreateDto`), `IPropertyService.cs` (add `AddRoomTypeAsync`), `Infrastructure/Services/PropertyService.cs`, `Api/Endpoints/PropertyEndpoints.cs`, `shared/contracts/openapi.yaml`.
- Test: `tests/PricePilot.UnitTests/RoomTypeCreateTests.cs`.

**Web (TS)**
- New shared components: `src/components/AsyncStatus.tsx`, `src/components/Explainer.tsx`, `src/components/PlacePicker.tsx` (+ co-located tests).
- New wizard feature folder: `src/features/setup/` — `SetupWizard.tsx`, `steps/StepName.tsx`, `steps/StepConfirmPlace.tsx`, `steps/StepRoom.tsx`, `steps/StepCompetitors.tsx`, `steps/StepFirstPrices.tsx`, `useSetupProgress.ts` (+ tests).
- Modify: `src/router.tsx` (add `/setup`), `src/auth/RequireAuth.tsx` unchanged, new `src/features/setup/SetupGuard.tsx`, `src/api/hooks.ts` (add `useCreateRoomType`), `src/api/types.ts` (add `RoomTypeCreate`), `src/components/Layout.tsx` (nav rename), `src/components/States.tsx` (actionable empty state), `src/features/*/*.tsx` (copy rewrite), `src/styles/global.css` (wizard + component styles, tokens).

**Contracts/docs:** `shared/contracts/openapi.yaml`, `docs/demo.md`, `docs/roadmap.md`.

---

### Task 1: Backend — room-type create endpoint

**Files:**
- Modify: `backend/src/PricePilot.Application/Dtos.cs`, `IPropertyService.cs`
- Modify: `backend/src/PricePilot.Infrastructure/Services/PropertyService.cs`
- Modify: `backend/src/PricePilot.Api/Endpoints/PropertyEndpoints.cs`, `shared/contracts/openapi.yaml`
- Modify: `web/src/api/types.ts` (add `RoomTypeCreate`), `web/src/api/hooks.ts` (add `useCreateRoomType`)
- Test: `backend/tests/PricePilot.UnitTests/RoomTypeCreateTests.cs`

**Interfaces:**
- Produces:
  - `RoomTypeCreateDto(string Name, int Capacity, decimal BasePrice, decimal? CurrentPrice, string? Currency)`.
  - `IPropertyService.AddRoomTypeAsync(Guid propertyId, RoomTypeCreateDto dto, CancellationToken ct) -> Task<RoomTypeDto?>` (null = property not the caller's → 404).
  - Endpoint `POST /properties/{propertyId}/room-types` → 201 + `RoomTypeDto` | 404 | 400.
  - Web: `RoomTypeCreate { name; capacity; basePrice; currentPrice?; currency? }`; hook `useCreateRoomType()` (mutation, invalidates `['properties']`).

- [ ] **Step 1: Write the failing test** — `RoomTypeCreateTests.cs` (WebApplicationFactory + SQLite; mirror `PropertyResolveEnqueueTests.cs` setup from the foundation branch for an authenticated tenant client + direct `AppDbContext` seeding of a property):

```csharp
[Fact]
public async Task Create_room_type_with_defaults_returns_201_and_appears_on_property()
{
    using var app = TestApi.Create();
    var client = app.TenantClient(TestApi.TenantA);
    var propertyId = await Seed.Property(app, TestApi.TenantA, city: "sibiu");

    var resp = await client.PostAsJsonAsync($"/api/v1/properties/{propertyId}/room-types",
        new { name = "Double room", capacity = 2, basePrice = 350.00m });
    Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
    var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
    Assert.Equal(350.00, body.GetProperty("currentPrice").GetDouble(), 3); // defaults to basePrice
    Assert.Equal("RON", body.GetProperty("currency").GetString());          // default currency

    var props = await client.GetFromJsonAsync<List<JsonElement>>("/api/v1/properties");
    var rooms = props!.Single(p => p.GetProperty("id").GetString() == propertyId.ToString())
        .GetProperty("roomTypes");
    Assert.Equal(1, rooms.GetArrayLength());
}

[Theory]
[InlineData(0, 350.0, "RON")]        // capacity < 1
[InlineData(2, 0.0, "RON")]          // price <= 0
[InlineData(2, 350.005, "RON")]      // > 2 decimals
[InlineData(2, 350.0, "RONI")]       // bad currency
public async Task Create_room_type_validation_returns_400(int capacity, double basePrice, string currency)
{
    using var app = TestApi.Create();
    var client = app.TenantClient(TestApi.TenantA);
    var propertyId = await Seed.Property(app, TestApi.TenantA, city: "sibiu");
    var resp = await client.PostAsJsonAsync($"/api/v1/properties/{propertyId}/room-types",
        new { name = "Double room", capacity, basePrice = (decimal)basePrice, currency });
    Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
}

[Fact]
public async Task Create_room_type_on_foreign_property_is_404()
{
    using var app = TestApi.Create();
    var propertyId = await Seed.Property(app, TestApi.TenantA, city: "sibiu");
    var client = app.TenantClient(TestApi.TenantB);
    var resp = await client.PostAsJsonAsync($"/api/v1/properties/{propertyId}/room-types",
        new { name = "Double room", capacity = 2, basePrice = 350.00m });
    Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
}
```

If the foundation branch's `TestApi`/`Seed` helpers aren't present, follow whatever WAF+SQLite setup the existing endpoint tests use (there are several) and seed a `Property` row directly via `AppDbContext`.

- [ ] **Step 2: Run to verify it fails**
Run: `cd backend && dotnet test --filter FullyQualifiedName~RoomTypeCreateTests`
Expected: FAIL — endpoint/service/DTO absent.

- [ ] **Step 3: Add the DTO** to `Dtos.cs`:

```csharp
public sealed record RoomTypeCreateDto(
    string Name, int Capacity, decimal BasePrice, decimal? CurrentPrice, string? Currency);
```

- [ ] **Step 4: Add the interface method** to `IPropertyService.cs`:

```csharp
/// <summary>Returns null when the property does not exist for the current tenant.</summary>
Task<RoomTypeDto?> AddRoomTypeAsync(Guid propertyId, RoomTypeCreateDto dto, CancellationToken ct);
```

- [ ] **Step 5: Implement in `PropertyService.cs`** (mirrors `AddCompetitorAsync`'s ownership pattern; validation lives in the endpoint layer, service assumes valid input + sets defaults):

```csharp
public async Task<RoomTypeDto?> AddRoomTypeAsync(Guid propertyId, RoomTypeCreateDto dto, CancellationToken ct)
{
    var tenantId = tenantContext.TenantId
        ?? throw new InvalidOperationException("Cannot create a room type without a resolved tenant.");
    var propertyExists = await db.Properties.AsNoTracking().AnyAsync(p => p.Id == propertyId, ct);
    if (!propertyExists) return null; // tenant filter => foreign id is simply not found

    var roomType = new RoomType
    {
        Id = Guid.NewGuid(),
        TenantId = tenantId,
        PropertyId = propertyId,
        Name = dto.Name.Trim(),
        Capacity = dto.Capacity,
        BasePrice = dto.BasePrice,
        CurrentPrice = dto.CurrentPrice ?? dto.BasePrice,
        Currency = (dto.Currency ?? "RON").ToUpperInvariant(),
    };
    db.RoomTypes.Add(roomType);
    await db.SaveChangesAsync(ct);
    return new RoomTypeDto(roomType.Id, roomType.Name, roomType.Capacity,
        roomType.BasePrice, roomType.CurrentPrice, roomType.Currency);
}
```

- [ ] **Step 6: Add the endpoint** in `PropertyEndpoints.cs` (validation before the service call, mirroring the existing competitor POST):

```csharp
group.MapPost("/{propertyId:guid}/room-types", async (
    Guid propertyId, RoomTypeCreateDto dto, IPropertyService properties,
    ITenantContext tenant, CancellationToken ct) =>
{
    if (tenant.TenantId is null) return Results.Unauthorized();
    if (string.IsNullOrWhiteSpace(dto.Name)) return Results.BadRequest(new { error = "name is required" });
    if (dto.Capacity < 1) return Results.BadRequest(new { error = "capacity must be at least 1" });
    if (dto.BasePrice <= 0 || decimal.Round(dto.BasePrice, 2) != dto.BasePrice)
        return Results.BadRequest(new { error = "basePrice must be > 0 with at most 2 decimals" });
    if (dto.CurrentPrice is { } cp && (cp <= 0 || decimal.Round(cp, 2) != cp))
        return Results.BadRequest(new { error = "currentPrice must be > 0 with at most 2 decimals" });
    if (dto.Currency is { } cur && cur.Length != 3)
        return Results.BadRequest(new { error = "currency must be a 3-letter code" });

    var created = await properties.AddRoomTypeAsync(propertyId, dto, ct);
    return created is null ? Results.NotFound() : Results.Created($"/api/v1/properties/{propertyId}/room-types", created);
});
```

- [ ] **Step 7: openapi + web mirror.** Add to `openapi.yaml`: `RoomTypeCreate` schema + `POST /properties/{propertyId}/room-types` (201/400/404). In `web/src/api/types.ts`:

```ts
export interface RoomTypeCreate {
  name: string;
  capacity: number;
  basePrice: number;
  currentPrice?: number;
  currency?: string;
}
```

In `web/src/api/hooks.ts` (mutation shape like `useUpdateRecommendationStatus`):

```ts
export function useCreateRoomType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ propertyId, body }: { propertyId: string; body: RoomTypeCreate }) =>
      apiFetch<RoomType>(`/properties/${propertyId}/room-types`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['properties'] }); },
  });
}
```
(Import `RoomType`, `RoomTypeCreate` from `./types`.)

- [ ] **Step 8: Run tests**
Run: `cd backend && dotnet build && dotnet test --filter FullyQualifiedName~RoomTypeCreateTests` then `cd ../web && npm run typecheck`
Expected: green.

- [ ] **Step 9: Commit** `feat(api): room-type create endpoint + web hook`

---

### Task 2: Web — shared UX primitives (AsyncStatus, Explainer, PlacePicker)

**Files:**
- Create: `web/src/components/AsyncStatus.tsx`, `web/src/components/Explainer.tsx`, `web/src/components/PlacePicker.tsx`
- Create tests: `web/src/components/AsyncStatus.test.tsx`, `Explainer.test.tsx`, `PlacePicker.test.tsx`
- Modify: `web/src/styles/global.css` (add `.async-status`, `.explainer`, `.place-picker` styles using existing tokens)

**Interfaces (later tasks consume these exact props):**
```ts
// AsyncStatus.tsx
export type AsyncPhase = 'working' | 'done' | 'failed';
export interface AsyncStatusProps {
  phase: AsyncPhase;             // derived by the caller from server state
  workingText: string;          // "Finding your place on Google…"
  doneText?: string;            // "Found it ✓"
  slowText?: string;            // default: "This is taking longer than usual…"
  failedText?: string;          // default: "We couldn't reach Google just now." — override per context
  timeoutMs?: number;           // default 20000; after this while still 'working' → show SLOW affordances
  onRetry?: () => void;         // shown in SLOW + FAILED
  onBackground?: () => void;    // shown in SLOW ("Keep working in the background")
}
// Explainer.tsx
export interface ExplainerProps { label: string; children: ReactNode } // "?" button + popover
// PlacePicker.tsx
export interface PlacePickerProps {
  candidates: PlaceCandidate[];
  onPick: (placeId: string) => void;
  onResearch: (query: string) => void;
  pending?: boolean;
}
```

- [ ] **Step 1: Write failing tests.**

`AsyncStatus.test.tsx` (fake timers for the working→slow escalation):
```tsx
import { act, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { AsyncStatus } from './AsyncStatus';

test('shows working text, then slow affordances after the timeout', () => {
  vi.useFakeTimers();
  const onRetry = vi.fn();
  render(<AsyncStatus phase="working" workingText="Finding your place…"
    onRetry={onRetry} onBackground={vi.fn()} timeoutMs={20000} />);
  expect(screen.getByText('Finding your place…')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(20000); });
  expect(screen.getByText(/taking longer than usual/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /keep working in the background/i })).toBeInTheDocument();
  vi.useRealTimers();
});

test('failed phase shows retry immediately; done shows done text', () => {
  const onRetry = vi.fn();
  const { rerender } = render(<AsyncStatus phase="failed" workingText="w" onRetry={onRetry} />);
  screen.getByRole('button', { name: /try again/i }).click();
  expect(onRetry).toHaveBeenCalled();
  rerender(<AsyncStatus phase="done" workingText="w" doneText="Found it ✓" />);
  expect(screen.getByText('Found it ✓')).toBeInTheDocument();
});

test('status region is announced to screen readers', () => {
  render(<AsyncStatus phase="working" workingText="Finding…" />);
  expect(screen.getByRole('status')).toHaveTextContent('Finding…');
});
```

`Explainer.test.tsx`: renders a `?` button labelled by `label`; clicking toggles a popover containing `children`; Escape/blur closes it; the popover is `role="tooltip"` or `aria-describedby`-linked.
`PlacePicker.test.tsx`: renders one radio per candidate (name + address + rating); selecting + submitting calls `onPick(placeId)`; the "search by a different name" field calls `onResearch(query)`; `pending` disables the submit.

- [ ] **Step 2: Run to verify they fail**
Run: `cd web && npm test -- --run src/components/AsyncStatus.test.tsx src/components/Explainer.test.tsx src/components/PlacePicker.test.tsx`
Expected: FAIL — components absent.

- [ ] **Step 3: Implement `AsyncStatus.tsx`.** The working→slow escalation is an internal timer (the only place timeout logic lives):

```tsx
import { useEffect, useState } from 'react';

export type AsyncPhase = 'working' | 'done' | 'failed';

export interface AsyncStatusProps {
  phase: AsyncPhase;
  workingText: string;
  doneText?: string;
  slowText?: string;
  timeoutMs?: number;
  onRetry?: () => void;
  onBackground?: () => void;
}

const DEFAULT_SLOW =
  'This is taking longer than usual. The setup service may not be running.';

export function AsyncStatus({
  phase, workingText, doneText, slowText = DEFAULT_SLOW,
  timeoutMs = 20000, onRetry, onBackground,
}: AsyncStatusProps) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (phase !== 'working') { setSlow(false); return; }
    const id = setTimeout(() => setSlow(true), timeoutMs);
    return () => clearTimeout(id);
  }, [phase, timeoutMs]);

  if (phase === 'done') {
    return <p className="async-status async-status-done" role="status">{doneText ?? workingText}</p>;
  }
  if (phase === 'failed') {
    return (
      <div className="async-status async-status-failed" role="alert">
        <p>We couldn't reach Google just now.</p>
        {onRetry && <button type="button" className="btn btn-secondary" onClick={onRetry}>Try again</button>}
      </div>
    );
  }
  // working (possibly escalated to slow)
  return (
    <div className="async-status async-status-working" role="status" aria-live="polite">
      <p>{slow ? slowText : workingText}</p>
      {slow && (
        <div className="async-status-actions">
          {onRetry && <button type="button" className="btn btn-secondary" onClick={onRetry}>Try again</button>}
          {onBackground && (
            <button type="button" className="btn btn-ghost" onClick={onBackground}>
              Keep working in the background
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement `Explainer.tsx`** — a small accessible popover: a `?` `<button>` with `aria-label={`What does "${label}" mean?`}`, toggling an adjacent `role="tooltip"` span (`id` linked via `aria-describedby`); closes on Escape and on outside click. Keyboard-reachable, ≥44px hit area via CSS. Keep it ~40 lines, no dependencies.

- [ ] **Step 5: Implement `PlacePicker.tsx`** — extract the candidate-radio + re-search markup that currently lives inline in `SettingsPage.tsx`'s `PlaceCorrection`, generalized to the props above (`candidates`, `onPick`, `onResearch`, `pending`). Reuse `formatRating` (see Task 6 for de-duplicating it into a shared helper — for now inline a local copy identical to the one in `CompetitorsPage.tsx`/`SettingsPage.tsx`). Radios named uniquely; submit disabled until a candidate is chosen; the "search by a different name" input calls `onResearch`.

- [ ] **Step 6: Styles.** Add `.async-status*`, `.explainer*`, `.place-picker*`, `.candidate-option` (if not already present) to `global.css` using existing tokens (`--space-*`, `--terracotta-*`, `--radius`, `--focus-ring`); reduced-motion: guard any spinner animation with `@media (prefers-reduced-motion: reduce)`.

- [ ] **Step 7: Run tests** `cd web && npm test -- --run src/components && npm run typecheck` → green.

- [ ] **Step 8: Commit** `feat(web): shared UX primitives - AsyncStatus, Explainer, PlacePicker`

---

### Task 3: Web — setup wizard part 1 (route, guard, steps ①–③)

**Files:**
- Create: `web/src/features/setup/SetupWizard.tsx`, `SetupGuard.tsx`, `useSetupProgress.ts`, `steps/StepName.tsx`, `steps/StepConfirmPlace.tsx`, `steps/StepRoom.tsx`
- Modify: `web/src/router.tsx`
- Create tests: `web/src/features/setup/SetupWizard.test.tsx` (steps ①–③), `useSetupProgress.test.ts`
- Modify: `web/src/styles/global.css` (`.setup-*` full-screen layout)

**Interfaces:**
- Consumes: `useCreateProperty`, `usePickPlace`, `useResolveProperty` (existing), `useCreateRoomType` (1), `PlacePicker`, `AsyncStatus` (2), `propertiesRefetchInterval` (existing from the foundation).
- Produces:
  - `useSetupProgress()` → `{ step: 1|2|3|4|5|'done', property?: Property }` derived purely from `useProperties()` server state (see step logic below). Later task 4 extends it to steps 4–5.
  - `<SetupWizard/>` mounted at `/setup` **outside** the Layout; `<SetupGuard/>` redirects.

**Step-derivation rule (the resume logic — pure, unit-tested):**
```
no properties                         → step 1 (name)
property exists, placeStatus!=resolved→ step 2 (confirm place)  (AsyncStatus while 'unresolved')
property resolved, no room types      → step 3 (room)
property resolved, ≥1 room type       → step 4 (competitors)     [4]
```

- [ ] **Step 1: Write failing tests** — `useSetupProgress.test.ts` (pure): feed it fixture `Property[]` states and assert the derived step (empty→1; unresolved→2; resolved+noRooms→3; resolved+rooms→4). `SetupWizard.test.tsx` (mocked fetch): typing a hotel name + town and submitting POSTs `/properties` and advances to the confirm step showing the candidates; picking a candidate PATCHes `.../place`; entering a room + rate POSTs `.../room-types`. Assert the wizard is full-screen (no nav/sidebar — e.g. `queryByRole('navigation')` is null). Use the mocked-fetch pattern from the foundation's `SettingsPage.test.tsx`.

- [ ] **Step 2: Run to verify they fail**
Run: `cd web && npm test -- --run src/features/setup`
Expected: FAIL — feature absent.

- [ ] **Step 3: Implement `useSetupProgress.ts`** — pure derivation from `useProperties()`:

```ts
import { useProperties } from '../../api/hooks';
import type { Property } from '../../api/types';

export type SetupStep = 1 | 2 | 3 | 4 | 5 | 'done';

export function deriveStep(properties: Property[]): { step: SetupStep; property?: Property } {
  if (properties.length === 0) return { step: 1 };
  const property = properties[0]; // onboarding is single-property; header selector is hidden here
  if (property.placeStatus !== 'resolved') return { step: 2, property };
  if (property.roomTypes.length === 0) return { step: 3, property };
  return { step: 4, property }; // steps 4/5 handled in 4
}

export function useSetupProgress() {
  const properties = useProperties();
  const data = properties.data ?? [];
  return { properties, ...deriveStep(data) };
}
```

- [ ] **Step 4: Implement the steps.**
  - `StepName.tsx`: `<label>What's your hotel called?` (name) + `<label>Which town?` (city) → `useCreateProperty().mutate({ name, city })`. On success the properties query invalidates → `useSetupProgress` advances to 2 automatically.
  - `StepConfirmPlace.tsx`: while `property.placeStatus==='unresolved'`, render `<AsyncStatus phase="working" workingText="Finding your place on Google…" onRetry={reResolve} onBackground={goDashboard} />` and poll via `useProperties({ refetchInterval: propertiesRefetchInterval })`. Once `placeCandidates` are present, render `<PlacePicker candidates={property.placeCandidates} onPick={id => pickPlace.mutate({propertyId, placeId:id})} onResearch={q => resolveProperty.mutate({propertyId, query:q})} />`. `placeStatus==='failed'` → PlacePicker with the re-search box surfaced.
  - `StepRoom.tsx`: name + sleeps + price/night + currency (default RON) → `useCreateRoomType().mutate({ propertyId, body })`.
  - Each step: focus moves to the step `<h1>` on mount (`ref` + `.focus()`), one primary button, progress dots `●○○○○`, a quiet "Skip for now" → `navigate('/')`.

- [ ] **Step 5: Implement `SetupWizard.tsx`** — reads `useSetupProgress()`, renders the step component for the current step, shows progress dots, handles the full-screen `.setup` layout (no Layout/sidebar). When `step` reaches 4, render the 4 steps (stub a "Finding competitors…" placeholder now; 4 fills it in).

- [ ] **Step 6: Implement `SetupGuard.tsx` + wire the router.** `SetupGuard`: if the owner has ≥1 property → `<Navigate to="/" replace/>` (they're set up); else render `<SetupWizard/>`. In `router.tsx` add a route **outside** the `/` Layout branch:

```tsx
{ path: '/setup', element: (<RequireAuth><SetupGuard /></RequireAuth>) },
```

(RequireAuth reused; SetupGuard handles the has-property redirect.) Conversely, the Dashboard's no-property empty state (Task 6) links to `/setup`.

- [ ] **Step 7: Styles** — `.setup` full-viewport centered column, `.setup-progress` dots, large inputs; reuse tokens. Full-bleed (no sidebar art).

- [ ] **Step 8: Run tests** `cd web && npm test -- --run src/features/setup && npm run typecheck && npm run build` → green.

- [ ] **Step 9: Commit** `feat(web): setup wizard - route, guard, steps 1-3 (hotel, confirm place, room)`

---

### Task 4: Web — setup wizard part 2 (steps ④–⑤ async, resume, dashboard nudge)

**Files:**
- Create: `web/src/features/setup/steps/StepCompetitors.tsx`, `steps/StepFirstPrices.tsx`
- Modify: `web/src/features/setup/SetupWizard.tsx`, `useSetupProgress.ts` (extend to 4/5), `web/src/features/dashboard/DashboardPage.tsx` (route a no-property owner to `/setup` + "Finish setting up" nudge)
- Modify tests: `web/src/features/setup/SetupWizard.test.tsx`, `useSetupProgress.test.ts`, `web/src/features/dashboard/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: `useCompetitors`, `useRecommendations`, `useTriggerJob` (existing), `AsyncStatus` (2).
- Extends `deriveStep`: `step 4` while competitors list is empty; `step 5` once competitors exist (owner triggers the pipeline, then sees the first recommendation); `'done'` once they leave the wizard.

- [ ] **Step 1: Write failing tests.** `useSetupProgress.test.ts`: add cases — resolved+rooms+**no competitors** → 4; +competitors → 5. `SetupWizard.test.tsx`: at step 4 with an empty competitors response, `AsyncStatus` shows "Finding hotels near you…"; when the mocked competitors response becomes non-empty, it advances and lists them; at step 5 a "Show me my first price" action triggers the 3 jobs (assert the 3 POSTs to `/jobs`) and, once a recommendation is present, shows the first recommendation card; the final button navigates to `/`. `DashboardPage.test.tsx`: a session with **zero properties** renders a "Let's set up your hotel" CTA linking to `/setup` (add this case; keep existing property cases green).

- [ ] **Step 2: Run to verify they fail** — `cd web && npm test -- --run src/features/setup src/features/dashboard` → FAIL.

- [ ] **Step 3: Extend `deriveStep`** — after the `roomTypes.length===0` check it currently returns step 4; make step 4 vs 5 depend on competitor presence. Since competitors aren't on `Property`, thread them in: change `deriveStep(properties, competitorsCount)` and have `useSetupProgress` read `useCompetitors(property?.id)`:

```ts
export function deriveStep(properties: Property[], competitorCount: number): { step: SetupStep; property?: Property } {
  if (properties.length === 0) return { step: 1 };
  const property = properties[0];
  if (property.placeStatus !== 'resolved') return { step: 2, property };
  if (property.roomTypes.length === 0) return { step: 3, property };
  if (competitorCount === 0) return { step: 4, property };
  return { step: 5, property };
}
```
Update `useSetupProgress.test.ts` and callers for the new signature.

- [ ] **Step 4: Implement `StepCompetitors.tsx`** — `useCompetitors(propertyId, { refetchInterval })`; while empty render `<AsyncStatus phase="working" workingText="Finding hotels near you…" failedText="We couldn't finish finding nearby hotels." timeoutMs={40000} onRetry={reDiscover} onBackground={goDashboard} />` (re-discover = `useResolveProperty` re-fires the chain, or a dedicated re-trigger — reuse `resolve-place` which chain-enqueues discovery). Once non-empty, show the discovered names + ratings and a "Next" button.

- [ ] **Step 5: Implement `StepFirstPrices.tsx`** — a primary "Show me my first price" button runs the pipeline exactly like the dashboard refresh (`scrape.competitor_rates` → `ingest.events` → `engine.generate_recommendations`, sequential `mutateAsync`), then polls `useRecommendations(propertyId, today, horizon, { refetchInterval })`; when a pending recommendation appears, render the first one (recommended price + the plain "why" from `factors`), with `[ Looks good — take me in → ]` → `navigate('/')`. Use `AsyncStatus` for the pipeline wait with the SLOW fallback (pass `failedText="We couldn't work out your first price just now."`).

- [ ] **Step 6: Dashboard nudge.** In `DashboardPage.tsx`, replace the current no-property `EmptyState` with an actionable block: `"Let's set up your hotel"` + `<Link to="/setup" className="btn btn-primary">Start setup →</Link>`. (Full copy rewrite of the rest of the dashboard is Task 6.)

- [ ] **Step 7: Wire steps 4/5 into `SetupWizard.tsx`** (replace the 3 stub).

- [ ] **Step 8: Run tests** `cd web && npm test -- --run src/features/setup src/features/dashboard && npm run typecheck && npm run build` → green.

- [ ] **Step 9: Commit** `feat(web): setup wizard - competitors + first-price steps, resume, dashboard nudge`

---

### Task 5: Web — dashboard "refresh" transparency

**Files:**
- Modify: `web/src/features/dashboard/DashboardPage.tsx`, `web/src/features/dashboard/DashboardPage.test.tsx`
- Possibly: `web/src/styles/global.css` (`.refresh-steps`)

**Interfaces:** consumes `AsyncStatus`/a small inline 3-step indicator + `useTriggerJob` (existing). No new hooks.

- [ ] **Step 1: Write failing test** — `DashboardPage.test.tsx`: clicking "Check for new prices" shows a 3-step progress (`Prices` → `What's on` → `Recalculating`), each ticking to ✓ as its `mutateAsync` resolves, and on a rejected job shows the FAILED state with Try again. Use a mocked `/jobs` fetch that resolves in order.

- [ ] **Step 2: Run to verify it fails** — `cd web && npm test -- --run src/features/dashboard` → FAIL.

- [ ] **Step 3: Implement** — replace the current "Refresh queued — …" one-liner with a small stepper driven by which of the three sequential `mutateAsync` calls have resolved (local state: `'idle'|'rates'|'events'|'engine'|'done'|'failed'`). Rename the button to **"Check for new prices"**. Show `Prices ✓ · What's on ✓ · Recalculating…`. On rejection → FAILED + Try again (re-runs `handleRefresh`); if using `AsyncStatus`, pass `failedText="We couldn't refresh your prices just now."`. Keep it react-query driven; no `useEffect` fetching (the sequential `mutateAsync` in the existing `handleRefresh` stays).

- [ ] **Step 4: Run tests** `cd web && npm test -- --run src/features/dashboard && npm run typecheck` → green.

- [ ] **Step 5: Commit** `feat(web): dashboard refresh shows real 3-step progress`

---

### Task 6: Web — app-wide plain-language rewrite + inline help + actionable empty states

**Dispatched as one focused task (web/ copy sweep). Read first:** `web/CLAUDE.md`, the spec's Workstream 3, every file under `src/features/`, `src/components/Layout.tsx`, `src/components/States.tsx`, and each page's existing test.

**Files:**
- Modify: `web/src/components/Layout.tsx` (nav labels), `src/components/States.tsx` (actionable empty-state variant), all `src/features/*/*.tsx` copy, and refactor `src/features/settings/SettingsPage.tsx`'s inline `PlaceCorrection` to use the shared `PlacePicker` + `AsyncStatus` (2); wire `Explainer` onto the competitor-band + "extra income" metrics; de-duplicate `formatRating` into `src/components/formatRating.ts`.
- Modify: every affected `*.test.tsx` for the new copy.

**Interfaces:** consumes `AsyncStatus`, `Explainer`, `PlacePicker`, `formatRating` shared helper.

**Copy map (apply consistently; nav renames change display labels only — routes stay):**

| Where | Now | Rewritten |
|---|---|---|
| Nav | Dashboard / Recommendations / Competitors / Events / Settings | **Home / Prices to review / Nearby hotels / What's on / Your hotel** |
| Dashboard | "Refresh data now" | **"Check for new prices"** (already done in 5) |
| Dashboard | "Estimated total impact" | **"Extra income if you accept all"** (+ `Explainer`) |
| Recommendations | "competitor band 380–455" | **"Nearby hotels charge 380–455 for these nights"** (+ `Explainer`) |
| Competitors page | "Competitors" / intro / empty | **"Nearby hotels"** / "Hotels near you we keep an eye on." / actionable empty |
| Settings | page + section copy | **"Your hotel"**; plain section labels |
| Errors | raw `ApiError` message | **"We couldn't reach Google just now — Try again"** (via `AsyncStatus`/`ErrorState` copy) |
| Empty states | text pointers | **buttons that do the next thing** |

- [ ] **Step 1: Failing tests first** — update each page's test to assert the NEW copy (they'll fail against old strings), plus a `States.test.tsx` case for the actionable empty variant (`EmptyState` with an optional `action={{label, to}}` renders a link/button).
- [ ] **Step 2: Run** `cd web && npm test -- --run` → RED on the reworded assertions.
- [ ] **Step 3: Implement** the copy changes + `States` actionable variant + `Explainer` wiring + `PlacePicker`/`AsyncStatus` refactor of Settings + shared `formatRating`. Extend `EmptyState`:
```tsx
export function EmptyState({ message, action }: { message: string; action?: { label: string; to: string } }) {
  return (
    <div className="state state-empty">
      <p>{message}</p>
      {action && <Link to={action.to} className="btn btn-primary">{action.label}</Link>}
    </div>
  );
}
```
- [ ] **Step 4: Run** `cd web && npm test -- --run && npm run typecheck && npm run build` → all green.
- [ ] **Step 5: Commit** `feat(web): plain-language rewrite, inline help, actionable empty states`

---

### Task 7: Verification + docs closeout

- [ ] **Step 1: Full suites.** `cd backend && dotnet build && dotnet test`; `cd web && npm test -- --run && npm run typecheck && npm run build`. Show output. (No dataplane changes; its suite is unaffected — a quick `pytest` sanity run is optional.)
- [ ] **Step 2: Manual smoke (fixture provider, full stack).** With `docker compose up --build`, log in as **`new@pricepilot.local` / `Demo1234!`** (the empty seed account) → confirm you're routed to `/setup` → walk the wizard (name → confirm place → room → competitors → first price) → land on Home. Confirm nothing hangs (worker running); stop the dataplane worker and confirm a step shows the SLOW state instead of an infinite spinner.
- [ ] **Step 3: Code review.** Dispatch the `code-reviewer` agent on the branch diff (a11y: focus/aria-live/reduced-motion; no `useEffect` fetching; no client-side money; tenant isolation on the new endpoint; contract drift on openapi/types). Address findings.
- [ ] **Step 4: Docs + memory.** Add the onboarding walkthrough to `docs/demo.md`; update `docs/roadmap.md` (usability overhaul landed; live-typeahead/signup/room-edit/pricing-rules still deferred). Commit `docs: usability overhaul closeout`.

## Execution notes

Order: 1 (backend contract lands first so web can code the room step) → 2 (primitives) → 3 → 4 (wizard) → 5 (dashboard) → 6 (copy sweep, last so it rewrites the final surfaces) → 7. 2 must precede 3–6 (they consume the primitives). No dev-DB dependency anywhere (room-type is SQLite-tested; the wizard runs on mocked fetch). The empty seed account (`new@pricepilot.local`) already exists on this branch for the manual smoke.

## Self-Review

- **Spec coverage:** onboarding wizard (3+4) ✓; async transparency primitive + wizard + dashboard (2, 4, 5) ✓; plain-language rewrite + inline help + actionable empty states (6) ✓; "Did you mean?" PlacePicker (2, used 3/6) ✓; room-type create backend (1) ✓; a11y focus/aria-live/reduced-motion (2, 3 steps) ✓; resume-on-reload (3/4 via `deriveStep`) ✓; never-dead-end (AsyncStatus SLOW + Skip) ✓. Deferred per spec (not in plan): live typeahead, signup, room-edit/accept-loop, pricing rules, i18n.
- **Type consistency:** `AsyncPhase = 'working'|'done'|'failed'` used identically in 2/4/5; `deriveStep` signature changes in 4 (from `(properties)` to `(properties, competitorCount)`) — 4 Step 3 explicitly updates callers + tests. `PlacePickerProps`/`RoomTypeCreate`/`useCreateRoomType` names consistent across 1/2/3/6. `EmptyState` gains an optional `action` prop (6) — backward compatible (existing callers pass only `message`).
- **Placeholder scan:** the 3 "step 4 stub" is explicitly replaced in 4 Step 7 (not a lingering TODO). No other placeholders.
