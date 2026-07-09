# Google Places Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner enters only their own property by name; the app resolves it to a Google place (geo + rating + review count), auto-discovers nearby competitors, and seeds city points of interest — all data ingested and displayed, with the pricing rules deferred to later slices.

**Architecture:** Backend writes core rows + enqueues jobs; the dataplane owns every Google call behind a `PlacesProvider` seam (live `GoogleAdapter` env-keyed, `FixtureAdapter` for tests/demo) and executes two new job types (`resolve_place`, `discover_competitors`) via the existing jobs table. Place data lives as columns on `properties`/`competitors` (tenant-scoped already); a new city-scoped `points_of_interest` table holds proximity references. No new cross-runtime calls.

**Tech Stack:** ASP.NET Core 9 minimal APIs + EF Core (xUnit, WebApplicationFactory + SQLite); Python 3.12 SQLAlchemy + APScheduler (pytest + ruff, `httpx.MockTransport` for the adapter); React 19 + react-query (Vitest/RTL).

**Spec:** `docs/superpowers/specs/2026-07-08-google-places-foundation-design.md`

## Global Constraints

- Money/coordinates are `decimal`/`numeric`, never float. Coordinates `numeric(9,6)`; rating `numeric(2,1)` (0.0–5.0); prices `numeric(10,2)`; currency `char(3)`. Floats appear only in serialized JSON payloads, never in computation.
- Every lookup by id goes through the tenant-filtered context; a foreign/absent id answers **404, never 403**. New writes set `TenantId` from `ITenantContext`, never from a request body.
- Schema change = EF migration + `AppDbContext` mapping + SQLAlchemy model + `shared/contracts/table-ownership.md`, all in the **same commit**. The dataplane never emits DDL.
- Contract files move with the code in the same commit: `jobs.md` (new job types — update first), `openapi.yaml` (endpoint changes), `table-ownership.md`, and a new `place-candidates.md` note.
- Backend: `dotnet build` (TreatWarningsAsErrors) + `dotnet test`. Dataplane: `pytest` + `ruff check src tests`. Web: `npm test -- --run`, `npm run typecheck`, `npm run build`.
- Scrapers/providers never hit live services in tests — fixtures only (`dataplane/tests/fixtures/`). `PLACES_PROVIDER` defaults to `fixture` so nothing bills Google without opt-in.
- Conventional commits; TDD per task; frequent commits.

## File Structure

**Backend (C#)**
- `src/PricePilot.Domain/Property.cs`, `Competitor.cs` — add place columns; new `src/PricePilot.Domain/PointOfInterest.cs`.
- `src/PricePilot.Infrastructure/AppDbContext.cs` — map the new columns/table + `PointsOfInterest` DbSet (city-scoped, NO tenant filter).
- `src/PricePilot.Infrastructure/Migrations/` — one new migration.
- `src/PricePilot.Application/Dtos.cs` — extend `PropertyDto`, `CompetitorDto`; add `PoiDto`, `PlaceCandidateDto`, `PlacePickDto`.
- `src/PricePilot.Application/IPropertyService.cs`, `JobTypes.cs`, new `IPoiQueries.cs`.
- `src/PricePilot.Infrastructure/Services/PropertyService.cs`, new `PoiQueries.cs`, `PricePilot.Infrastructure/PoiSeeder.cs`.
- `src/PricePilot.Api/Endpoints/PropertyEndpoints.cs`, new `PoiEndpoints.cs`; DI in `Program.cs`.
- `tests/PricePilot.UnitTests/` — new test classes per task.

**Dataplane (Python)** — new package `src/pricepilot/places/`
- `__init__.py` (registry), `models.py` (`PlaceCandidate`), `provider.py` (`PlacesProvider` Protocol), `google.py` (`GoogleAdapter`), `fixture.py` (`FixtureAdapter`), `capture.py` (CLI).
- `src/pricepilot/db/tables.py` — map new columns + `PointOfInterest`.
- `src/pricepilot/scheduler/jobs.py` — two handlers + registry entries.
- `src/pricepilot/config.py` — four new settings.
- `tests/fixtures/places/*.json`, `tests/test_places_provider.py`, `tests/test_place_jobs.py`.

**Web (TS)**
- `src/api/types.ts`, `src/api/hooks.ts`.
- `src/features/settings/SettingsPage.tsx` (+ private components), `src/features/competitors/CompetitorsPage.tsx`.
- `src/styles/global.css` (tokens only if needed).

**Contracts / docs / env**
- `shared/contracts/{jobs.md,openapi.yaml,table-ownership.md,place-candidates.md}`, `.env.example`, `docs/demo.md`, `docs/roadmap.md`.

---

### Task 1: Schema — place columns + `points_of_interest`

**Files:**
- Modify: `backend/src/PricePilot.Domain/Property.cs`, `backend/src/PricePilot.Domain/Competitor.cs`
- Create: `backend/src/PricePilot.Domain/PointOfInterest.cs`
- Modify: `backend/src/PricePilot.Infrastructure/AppDbContext.cs`
- Create: EF migration `GooglePlacesFoundation`
- Modify: `dataplane/src/pricepilot/db/tables.py`
- Modify: `shared/contracts/table-ownership.md`
- Test: `backend/tests/PricePilot.UnitTests/PlaceSchemaTests.cs`; dataplane `tests/integration/test_schema_sync.py` (existing — must stay green)

**Interfaces:**
- Produces (later tasks rely on these exact members):
  - `Property`: `string? PlaceId`, `decimal? Latitude`, `decimal? Longitude`, `decimal? Rating`, `int? RatingCount`, `DateTimeOffset? PlaceResolvedAt`, `string? PlaceCandidates` (JSONB as string).
  - `Competitor`: same seven, plus `DateTimeOffset? DiscoveredAt`, `string? DiscoverySource`, `DateTimeOffset? ExcludedAt`; `SourceUrl` becomes `string?` (nullable).
  - `PointOfInterest`: `Guid Id`, `string City`, `string Name`, `decimal Latitude`, `decimal Longitude`, `int Weight`, `DateTimeOffset CreatedAt` (NOT `ITenantOwned`).
  - SQLAlchemy `Property`/`Competitor` gain the same mapped columns; new `PointOfInterest` model maps `points_of_interest`.

- [ ] **Step 1: Write the failing test** — `backend/tests/PricePilot.UnitTests/PlaceSchemaTests.cs`. Follow the SQLite context setup used by existing unit tests (see any test that news up `AppDbContext` with SQLite in-memory; e.g. the tenant-filter tests). Assert the new columns round-trip and the POI table is reachable:

```csharp
using Microsoft.EntityFrameworkCore;
using PricePilot.Domain;

public class PlaceSchemaTests
{
    [Fact]
    public async Task Property_persists_google_place_fields()
    {
        using var ctx = TestDb.NewContext(tenantId: TestDb.TenantA); // shared helper (see existing tests)
        var p = new Property
        {
            Id = Guid.NewGuid(), TenantId = TestDb.TenantA, Name = "Hotel X", City = "sibiu",
            PlaceId = "ChIJabc", Latitude = 45.798300m, Longitude = 24.125600m,
            Rating = 4.4m, RatingCount = 1280, PlaceResolvedAt = DateTimeOffset.UtcNow,
            PlaceCandidates = "[]", CreatedAt = DateTimeOffset.UtcNow,
        };
        ctx.Properties.Add(p);
        await ctx.SaveChangesAsync();

        var loaded = await ctx.Properties.AsNoTracking().SingleAsync(x => x.Id == p.Id);
        Assert.Equal(45.798300m, loaded.Latitude);
        Assert.Equal(4.4m, loaded.Rating);
        Assert.Equal(1280, loaded.RatingCount);
    }

    [Fact]
    public async Task Poi_is_not_tenant_filtered()
    {
        using var ctx = TestDb.NewContext(tenantId: Guid.Empty); // no tenant resolved
        ctx.PointsOfInterest.Add(new PointOfInterest
        {
            Id = Guid.NewGuid(), City = "sibiu", Name = "Piata Mare",
            Latitude = 45.797300m, Longitude = 24.152100m, Weight = 100,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await ctx.SaveChangesAsync();
        Assert.Equal(1, await ctx.PointsOfInterest.CountAsync()); // visible without a tenant
    }
}
```

If no shared `TestDb` helper exists, create the SQLite in-memory context inline exactly as the nearest existing unit test does (open connection, `UseSqlite`, `EnsureCreated`, pass a stub `ITenantContext`).

- [ ] **Step 2: Run to verify it fails**
Run: `cd backend && dotnet test --filter FullyQualifiedName~PlaceSchemaTests`
Expected: FAIL — `Property` has no `PlaceId`/`Latitude`/… and `PointsOfInterest` does not exist.

- [ ] **Step 3: Add domain fields.** In `Property.cs` add after `Address`:

```csharp
    public string? PlaceId { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public decimal? Rating { get; set; }
    public int? RatingCount { get; set; }
    public DateTimeOffset? PlaceResolvedAt { get; set; }
    /// <summary>Top-5 search candidates for the correction picker; JSONB, opaque to the backend.</summary>
    public string? PlaceCandidates { get; set; }
```

In `Competitor.cs`: change `public required string SourceUrl` to `public string? SourceUrl { get; set; }`, and add the same seven place fields plus:

```csharp
    public DateTimeOffset? DiscoveredAt { get; set; }
    public string? DiscoverySource { get; set; }
    public DateTimeOffset? ExcludedAt { get; set; }
```

Create `PointOfInterest.cs`:

```csharp
namespace PricePilot.Domain;

/// <summary>City-scoped proximity reference (NOT tenant-owned) — like Event.</summary>
public class PointOfInterest
{
    public Guid Id { get; set; }
    public required string City { get; set; }
    public required string Name { get; set; }
    public decimal Latitude { get; set; }
    public decimal Longitude { get; set; }
    public int Weight { get; set; } // 0..100 importance
    public DateTimeOffset CreatedAt { get; set; }
}
```

- [ ] **Step 4: Map in `AppDbContext`.** Add `public DbSet<PointOfInterest> PointsOfInterest => Set<PointOfInterest>();`. In `OnModelCreating`, extend the `Property` and `Competitor` entity blocks:

```csharp
        modelBuilder.Entity<Property>(e =>
        {
            // ...existing...
            e.Property(x => x.PlaceId).HasMaxLength(300);
            e.Property(x => x.Latitude).HasPrecision(9, 6);
            e.Property(x => x.Longitude).HasPrecision(9, 6);
            e.Property(x => x.Rating).HasPrecision(2, 1);
            e.Property(x => x.PlaceCandidates).HasColumnType("jsonb");
        });

        modelBuilder.Entity<Competitor>(e =>
        {
            // ...existing... (SourceUrl stays HasMaxLength(2000); now nullable by type)
            e.Property(x => x.PlaceId).HasMaxLength(300);
            e.Property(x => x.Latitude).HasPrecision(9, 6);
            e.Property(x => x.Longitude).HasPrecision(9, 6);
            e.Property(x => x.Rating).HasPrecision(2, 1);
            e.Property(x => x.PlaceCandidates).HasColumnType("jsonb");
            e.Property(x => x.DiscoverySource).HasMaxLength(50);
        });
```

Add a new mapping block (place it near the `Event` block; it is city-scoped, so **no query filter**):

```csharp
        modelBuilder.Entity<PointOfInterest>(e =>
        {
            e.HasIndex(x => x.City);
            e.Property(x => x.City).HasMaxLength(100);
            e.Property(x => x.Name).HasMaxLength(300);
            e.Property(x => x.Latitude).HasPrecision(9, 6);
            e.Property(x => x.Longitude).HasPrecision(9, 6);
        });
```

Do NOT add `PointOfInterest` to the `HasQueryFilter` list (it is not tenant-owned).

- [ ] **Step 5: Create the migration.**
Run: `cd backend && dotnet tool restore && dotnet tool run dotnet-ef migrations add GooglePlacesFoundation --project src/PricePilot.Infrastructure --startup-project src/PricePilot.Api`
Open the generated migration and verify it only ADDs columns to `properties`/`competitors`, ALTERs `competitors.source_url` to nullable, and CREATEs `points_of_interest`. No unrelated drops.

- [ ] **Step 6: Update the SQLAlchemy mapping** in `dataplane/src/pricepilot/db/tables.py`. Add to `Property`:

```python
    place_id: Mapped[str | None] = mapped_column(String(300))
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    rating: Mapped[Decimal | None] = mapped_column(Numeric(2, 1))
    rating_count: Mapped[int | None] = mapped_column(Integer)
    place_resolved_at: Mapped[datetime | None]
    place_candidates: Mapped[dict[str, Any] | None]  # JSONB (array); opaque
```

> Note: `place_candidates` holds a JSON **array**; the `dict[str, Any]` type-annotation map still routes it to the `JSONB` column type (SQLAlchemy uses the column type, not the Python value shape). This matches how `factors`/`payload` are mapped.

Add the same seven to `Competitor`, plus `discovered_at: Mapped[datetime | None]`, `discovery_source: Mapped[str | None] = mapped_column(String(50))`, `excluded_at: Mapped[datetime | None]`, and change `source_url` to `Mapped[str | None] = mapped_column(String(2000))`. Add a new model:

```python
class PointOfInterest(Base):
    """City-scoped proximity reference — NOT tenant-scoped."""

    __tablename__ = "points_of_interest"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    city: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(300))
    latitude: Mapped[Decimal] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Decimal] = mapped_column(Numeric(9, 6))
    weight: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
```

- [ ] **Step 7: Update `shared/contracts/table-ownership.md`.** In the `properties` and `competitors` rows note the new Google place columns (and that `competitors.source_url` is now nullable — auto-discovered rows have none; the scraper matches by name; `excluded_at` is the untrack tombstone). Add a `points_of_interest` row: `backend | city-scoped (NOT tenant-scoped); seeded landmarks with lat/lng + weight for the proximity rule`.

- [ ] **Step 8: Run backend tests + schema sync.**
Run: `cd backend && dotnet build && dotnet test --filter FullyQualifiedName~PlaceSchemaTests`
Expected: PASS (0 warnings).
The dev-DB apply + dataplane `test_schema_sync` run is a verification step in Task 10 (needs a running Postgres; may be human-in-the-loop).

- [ ] **Step 9: Commit**
```bash
git add backend/src dataplane/src/pricepilot/db/tables.py shared/contracts/table-ownership.md
git commit -m "feat: google place columns + points_of_interest schema"
```

---

### Task 2: Backend — job types + place DTOs + create enqueues `resolve_place`

**Files:**
- Modify: `shared/contracts/jobs.md` (add the two types **first**), `shared/contracts/openapi.yaml`, new `shared/contracts/place-candidates.md`
- Modify: `backend/src/PricePilot.Application/JobTypes.cs`, `Dtos.cs`, `IPropertyService.cs`
- Modify: `backend/src/PricePilot.Infrastructure/Services/PropertyService.cs`
- Modify: `backend/src/PricePilot.Api/Endpoints/PropertyEndpoints.cs`
- Test: `backend/tests/PricePilot.UnitTests/PropertyResolveEnqueueTests.cs`

**Interfaces:**
- Consumes: `IJobDispatcher.EnqueueAsync(type, payload, requestedBy, ct)` (`JobDispatcher.cs:10`); place columns from Task 1.
- Produces:
  - `JobTypes.ResolvePlace = "resolve_place"`, `JobTypes.DiscoverCompetitors = "discover_competitors"`, both added to `All`.
  - `PropertyDto` gains `decimal? Latitude, decimal? Longitude, decimal? Rating, int? RatingCount, string PlaceStatus, IReadOnlyList<PlaceCandidateDto> PlaceCandidates`.
  - `PlaceCandidateDto(string PlaceId, string Name, string? FormattedAddress, decimal? Latitude, decimal? Longitude, decimal? Rating, int? RatingCount)`.
  - `IPropertyService.CreateAsync` unchanged signature but now enqueues (see below); new `Task<PropertyDto> CreateAndEnqueueResolveAsync(...)` is NOT introduced — the endpoint enqueues via `IJobDispatcher` after `CreateAsync`, mirroring the refresh-button pattern, so the service stays free of job concerns.

- [ ] **Step 1: Add the job types to `shared/contracts/jobs.md`** (update-first rule). Add two rows to the Job types table:

```
| `resolve_place` | `{"property_id": "<uuid>"}` | Resolve a property to a Google place (text search), write place_id/geo/rating + top-5 candidates, then enqueue discover_competitors |
| `discover_competitors` | `{"property_id": "<uuid>"}` | Nearby-search lodging around the resolved property; upsert competitor rows with Google data; skip the property's own place and tombstoned (excluded) rows |
```

Add result-shape notes: `resolve_place` → `{"property_id": "...", "resolved": true, "place_id": "...", "candidate_count": 5}` or `{"resolved": false, "reason": "no match for '<query>'"}`; `discover_competitors` → `{"property_id": "...", "discovered": 4, "skipped_excluded": 1, "capped": 0}`.

- [ ] **Step 2: Write the failing test** — `PropertyResolveEnqueueTests.cs` (WebApplicationFactory + SQLite, mirror the setup in existing endpoint tests such as `JobEndpoints`/`Property` tests). Two cases:

```csharp
[Fact]
public async Task Post_property_creates_row_and_enqueues_resolve_place()
{
    using var app = TestApi.Create();           // existing WAF helper
    var client = app.TenantClient(TestApi.TenantA);

    var resp = await client.PostAsJsonAsync("/api/v1/properties",
        new { name = "Hotel Continental Forum", city = "sibiu" });
    resp.EnsureSuccessStatusCode();             // 201

    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var job = await db.Jobs.AsNoTracking().SingleAsync(j => j.Type == "resolve_place");
    Assert.Contains("property_id", job.Payload);
}

[Fact]
public async Task Get_properties_reports_place_status_unresolved_before_resolution()
{
    using var app = TestApi.Create();
    var client = app.TenantClient(TestApi.TenantA);
    await client.PostAsJsonAsync("/api/v1/properties", new { name = "Hotel X", city = "sibiu" });

    var list = await client.GetFromJsonAsync<List<JsonElement>>("/api/v1/properties");
    Assert.Equal("unresolved", list!.Single().GetProperty("placeStatus").GetString());
}
```

- [ ] **Step 3: Run to verify it fails**
Run: `cd backend && dotnet test --filter FullyQualifiedName~PropertyResolveEnqueueTests`
Expected: FAIL — no `resolve_place` job enqueued; `placeStatus` missing.

- [ ] **Step 4: Extend `JobTypes.cs`** — add the two constants and include them in `All`:

```csharp
    public const string ResolvePlace = "resolve_place";
    public const string DiscoverCompetitors = "discover_competitors";
```

- [ ] **Step 5: Extend DTOs** in `Dtos.cs`:

```csharp
public sealed record PlaceCandidateDto(
    string PlaceId, string Name, string? FormattedAddress,
    decimal? Latitude, decimal? Longitude, decimal? Rating, int? RatingCount);

public sealed record PropertyDto(
    Guid Id, string Name, string City, string? Address,
    decimal? Latitude, decimal? Longitude, decimal? Rating, int? RatingCount,
    string PlaceStatus, // "unresolved" | "resolved" | "failed"
    IReadOnlyList<PlaceCandidateDto> PlaceCandidates,
    IReadOnlyList<RoomTypeDto> RoomTypes);
```

- [ ] **Step 6: Update `PropertyService.ToDto` + `CreateAsync`** in `PropertyService.cs`. `ToDto` now derives `PlaceStatus` and deserializes candidates:

```csharp
    private static PropertyDto ToDto(Property property, IEnumerable<RoomType> roomTypes)
    {
        var status = property.PlaceResolvedAt is not null ? "resolved"
            : property.PlaceCandidates is "__failed__" ? "failed"
            : "unresolved";
        var candidates = DeserializeCandidates(property.PlaceCandidates);
        return new PropertyDto(
            property.Id, property.Name, property.City, property.Address,
            property.Latitude, property.Longitude, property.Rating, property.RatingCount,
            status, candidates,
            roomTypes.Select(rt => new RoomTypeDto(rt.Id, rt.Name, rt.Capacity, rt.BasePrice, rt.CurrentPrice, rt.Currency)).ToList());
    }

    private static IReadOnlyList<PlaceCandidateDto> DeserializeCandidates(string? json) =>
        string.IsNullOrWhiteSpace(json) || json == "__failed__"
            ? []
            : JsonSerializer.Deserialize<List<PlaceCandidateDto>>(json,
                new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? [];
```

> **Failure sentinel decision:** the dataplane writes the literal string `"__failed__"` into `place_candidates` when resolution finds no match (and leaves `place_resolved_at` null). This keeps `place_status` derivable from columns already present without a dedicated status column. Document this in `place-candidates.md` (Step 8) so the dataplane honors it (Task 7). Simpler alternative rejected: a separate `place_status` column would need another migration for a three-state enum the UI can already derive.

`CreateAsync` is unchanged (it already returns `ToDto(property, [])`).

- [ ] **Step 7: Enqueue in the endpoint.** In `PropertyEndpoints.cs`, the `POST /` handler injects `IJobDispatcher jobs` and, after `CreateAsync`, enqueues:

```csharp
            var created = await properties.CreateAsync(dto, ct);
            using var payloadDoc = JsonDocument.Parse(
                $$"""{"property_id":"{{created.Id}}"}""");
            await jobs.EnqueueAsync(JobTypes.ResolvePlace, payloadDoc.RootElement.Clone(), requestedBy: null, ct);
            return Results.Created($"/api/v1/properties/{created.Id}", created);
```

(Add `using System.Text.Json;` at the top.)

- [ ] **Step 8: Contracts.** Create `shared/contracts/place-candidates.md` documenting the `place_candidates` JSONB array shape (the spec's shape block), the `"__failed__"` sentinel, and that consumers treat it as opaque display data. Update `openapi.yaml`: extend the `Property` schema with the new fields + `placeStatus` enum; note `POST /properties` now enqueues `resolve_place`.

- [ ] **Step 9: Run tests**
Run: `cd backend && dotnet build && dotnet test --filter FullyQualifiedName~PropertyResolveEnqueueTests`
Expected: PASS.

- [ ] **Step 10: Commit**
```bash
git add backend/src shared/contracts
git commit -m "feat(api): create property enqueues resolve_place; expose place fields + status"
```

---

### Task 3: Backend — correction endpoints (re-resolve + pick candidate)

**Files:**
- Modify: `backend/src/PricePilot.Application/IPropertyService.cs`, `Dtos.cs`
- Modify: `backend/src/PricePilot.Infrastructure/Services/PropertyService.cs`
- Modify: `backend/src/PricePilot.Api/Endpoints/PropertyEndpoints.cs`, `shared/contracts/openapi.yaml`
- Test: `backend/tests/PricePilot.UnitTests/PropertyCorrectionTests.cs`

**Interfaces:**
- Consumes: place columns (Task 1); `PlaceCandidateDto` (Task 2); `IJobDispatcher` (endpoint enqueues re-resolve).
- Produces on `IPropertyService`:
  - `Task<bool> PickPlaceAsync(Guid propertyId, string placeId, CancellationToken ct)` — copies the chosen candidate's fields onto the property; returns `false` when the property isn't the caller's, throws `PlaceCandidateNotFoundException` when `placeId` isn't among stored candidates (endpoint maps to 400).
  - `Task<bool> ClearResolutionForRetryAsync(Guid propertyId, CancellationToken ct)` — verifies ownership (returns false if foreign); the endpoint then enqueues a fresh `resolve_place`.
- Endpoints: `PATCH /properties/{id}/place {placeId}` → 200 + Property | 400 (unknown candidate) | 404; `POST /properties/{id}/resolve-place {query?}` → 202 | 404.

- [ ] **Step 1: Write the failing test** — `PropertyCorrectionTests.cs`. Seed a property with two candidates in `place_candidates`, then:

```csharp
[Fact]
public async Task Pick_place_copies_candidate_fields_and_sets_resolved()
{
    using var app = TestApi.Create();
    var client = app.TenantClient(TestApi.TenantA);
    var propertyId = await Seed.PropertyWithCandidates(app, TestApi.TenantA, // helper seeds place_candidates JSON
        picked: ("ChIJ_right", 45.7960m, 24.1520m, 4.6m, 900));

    var resp = await client.PatchAsJsonAsync($"/api/v1/properties/{propertyId}/place",
        new { placeId = "ChIJ_right" });
    resp.EnsureSuccessStatusCode();
    var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
    Assert.Equal("resolved", body.GetProperty("placeStatus").GetString());
    Assert.Equal(4.6, body.GetProperty("rating").GetDouble(), 3);
}

[Fact]
public async Task Pick_unknown_candidate_is_400()
{
    using var app = TestApi.Create();
    var client = app.TenantClient(TestApi.TenantA);
    var propertyId = await Seed.PropertyWithCandidates(app, TestApi.TenantA, picked: default);
    var resp = await client.PatchAsJsonAsync($"/api/v1/properties/{propertyId}/place",
        new { placeId = "ChIJ_not_a_candidate" });
    Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
}

[Fact]
public async Task Pick_foreign_property_is_404()
{
    using var app = TestApi.Create();
    var propertyId = await Seed.PropertyWithCandidates(app, TestApi.TenantA, picked: default);
    var client = app.TenantClient(TestApi.TenantB); // different tenant
    var resp = await client.PatchAsJsonAsync($"/api/v1/properties/{propertyId}/place",
        new { placeId = "ChIJ_right" });
    Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
}

[Fact]
public async Task Resolve_place_endpoint_enqueues_job()
{
    using var app = TestApi.Create();
    var client = app.TenantClient(TestApi.TenantA);
    var propertyId = await Seed.PropertyWithCandidates(app, TestApi.TenantA, picked: default);
    var resp = await client.PostAsJsonAsync($"/api/v1/properties/{propertyId}/resolve-place",
        new { query = "Hotel Continental Forum Sibiu" });
    Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    Assert.Equal(1, await db.Jobs.CountAsync(j => j.Type == "resolve_place"));
}
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd backend && dotnet test --filter FullyQualifiedName~PropertyCorrectionTests`
Expected: FAIL — endpoints/methods absent.

- [ ] **Step 3: Add DTO + exception + interface members.** In `Dtos.cs`: `public sealed record PlacePickDto(string PlaceId);` and `public sealed record ResolvePlaceDto(string? Query);`. Add a small exception (in `Application`): 

```csharp
public sealed class PlaceCandidateNotFoundException(string placeId)
    : Exception($"place_id '{placeId}' is not among the stored candidates");
```

Add to `IPropertyService` the two methods from Interfaces above.

- [ ] **Step 4: Implement in `PropertyService.cs`:**

```csharp
    public async Task<bool> PickPlaceAsync(Guid propertyId, string placeId, CancellationToken ct)
    {
        var property = await db.Properties.FirstOrDefaultAsync(p => p.Id == propertyId, ct);
        if (property is null) return false; // tenant filter => foreign id is "not found"

        var candidates = DeserializeCandidates(property.PlaceCandidates);
        var chosen = candidates.FirstOrDefault(c => c.PlaceId == placeId)
            ?? throw new PlaceCandidateNotFoundException(placeId);

        property.PlaceId = chosen.PlaceId;
        property.Latitude = chosen.Latitude;
        property.Longitude = chosen.Longitude;
        property.Rating = chosen.Rating;
        property.RatingCount = chosen.RatingCount;
        property.PlaceResolvedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<bool> ClearResolutionForRetryAsync(Guid propertyId, CancellationToken ct) =>
        await db.Properties.AsNoTracking().AnyAsync(p => p.Id == propertyId, ct);
```

> `ClearResolutionForRetryAsync` only confirms ownership; the actual re-resolution is the dataplane job's job (it overwrites the place fields + candidates). Keeping the write in one place (the handler) avoids a torn state where columns are cleared but no job runs.

- [ ] **Step 5: Add the endpoints** in `PropertyEndpoints.cs` (inside `MapPropertyEndpoints`):

```csharp
        group.MapPatch("/{propertyId:guid}/place", async (
            Guid propertyId, PlacePickDto dto, IPropertyService properties, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(dto.PlaceId))
                return Results.BadRequest(new { error = "placeId is required" });
            try
            {
                var ok = await properties.PickPlaceAsync(propertyId, dto.PlaceId, ct);
                if (!ok) return Results.NotFound();
                var updated = (await properties.ListAsync(ct)).First(p => p.Id == propertyId);
                return Results.Ok(updated);
            }
            catch (PlaceCandidateNotFoundException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapPost("/{propertyId:guid}/resolve-place", async (
            Guid propertyId, ResolvePlaceDto dto, IPropertyService properties,
            IJobDispatcher jobs, CancellationToken ct) =>
        {
            if (!await properties.ClearResolutionForRetryAsync(propertyId, ct))
                return Results.NotFound();
            var query = string.IsNullOrWhiteSpace(dto.Query) ? null : dto.Query.Trim();
            var json = query is null
                ? $$"""{"property_id":"{{propertyId}}"}"""
                : $$"""{"property_id":"{{propertyId}}","query":{{JsonSerializer.Serialize(query)}}}""";
            using var payloadDoc = JsonDocument.Parse(json);
            var job = await jobs.EnqueueAsync(JobTypes.ResolvePlace, payloadDoc.RootElement.Clone(), null, ct);
            return Results.Accepted($"/api/v1/jobs/{job.Id}", job);
        });
```

> Note: `resolve_place` payload may carry an optional `"query"` override. Extend the `jobs.md` `resolve_place` payload note to `{"property_id": "<uuid>", "query": "<string>|absent"}` (absent = use the property's name + city). Update it now.

- [ ] **Step 6: Update `openapi.yaml`** with the two paths + `PlacePick`/`ResolvePlace` request bodies and responses (200/202/400/404).

- [ ] **Step 7: Run tests**
Run: `cd backend && dotnet build && dotnet test --filter FullyQualifiedName~PropertyCorrectionTests`
Expected: PASS.

- [ ] **Step 8: Commit**
```bash
git add backend/src shared/contracts/openapi.yaml shared/contracts/jobs.md
git commit -m "feat(api): property place correction - pick candidate + re-resolve"
```

---

### Task 4: Backend — discovered-competitor list + untrack (soft-delete); drop manual create

**Files:**
- Modify: `backend/src/PricePilot.Application/IPropertyService.cs`, `Dtos.cs`
- Modify: `backend/src/PricePilot.Infrastructure/Services/PropertyService.cs`
- Modify: `backend/src/PricePilot.Api/Endpoints/PropertyEndpoints.cs`, `shared/contracts/openapi.yaml`
- Test: `backend/tests/PricePilot.UnitTests/CompetitorDiscoveryTests.cs`

**Interfaces:**
- Consumes: competitor place columns + `ExcludedAt` (Task 1).
- Produces on `IPropertyService`:
  - `Task<bool> UntrackCompetitorAsync(Guid competitorId, CancellationToken ct)` — sets `ExcludedAt = now`; returns false when not the caller's or already excluded.
  - `CompetitorDto` gains `decimal? Rating, int? RatingCount, decimal? Latitude, decimal? Longitude`; `SourceUrl` becomes `string?`.
  - `ListCompetitorsAsync` now filters `c.ExcludedAt == null`.
  - `AddCompetitorAsync` and the `POST …/competitors` endpoint are **removed**.

- [ ] **Step 1: Write the failing test** — `CompetitorDiscoveryTests.cs`:

```csharp
[Fact]
public async Task Untrack_sets_excluded_and_hides_from_list()
{
    using var app = TestApi.Create();
    var client = app.TenantClient(TestApi.TenantA);
    var (propertyId, competitorId) = await Seed.DiscoveredCompetitor(app, TestApi.TenantA);

    var del = await client.DeleteAsync($"/api/v1/competitors/{competitorId}");
    Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

    var list = await client.GetFromJsonAsync<List<JsonElement>>(
        $"/api/v1/properties/{propertyId}/competitors");
    Assert.Empty(list!);

    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var row = await db.Competitors.IgnoreQueryFilters().SingleAsync(c => c.Id == competitorId);
    Assert.NotNull(row.ExcludedAt); // tombstone row persists
}

[Fact]
public async Task Untrack_foreign_competitor_is_404()
{
    using var app = TestApi.Create();
    var (_, competitorId) = await Seed.DiscoveredCompetitor(app, TestApi.TenantA);
    var client = app.TenantClient(TestApi.TenantB);
    var del = await client.DeleteAsync($"/api/v1/competitors/{competitorId}");
    Assert.Equal(HttpStatusCode.NotFound, del.StatusCode);
}

[Fact]
public async Task Competitor_list_exposes_rating()
{
    using var app = TestApi.Create();
    var client = app.TenantClient(TestApi.TenantA);
    var (propertyId, _) = await Seed.DiscoveredCompetitor(app, TestApi.TenantA, rating: 4.2m, ratingCount: 512);
    var list = await client.GetFromJsonAsync<List<JsonElement>>(
        $"/api/v1/properties/{propertyId}/competitors");
    Assert.Equal(4.2, list!.Single().GetProperty("rating").GetDouble(), 3);
}
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd backend && dotnet test --filter FullyQualifiedName~CompetitorDiscoveryTests`
Expected: FAIL — no `DELETE /competitors/{id}`; `rating` missing.

- [ ] **Step 3: Update `CompetitorDto`** in `Dtos.cs`:

```csharp
public sealed record CompetitorDto(
    Guid Id, string Name, string? SourceUrl,
    decimal? Rating, int? RatingCount, decimal? Latitude, decimal? Longitude,
    IReadOnlyList<CompetitorRateDto> LatestRates);
```

Delete `CompetitorCreateDto`.

- [ ] **Step 4: Update `IPropertyService`** — remove `AddCompetitorAsync`; add `Task<bool> UntrackCompetitorAsync(Guid competitorId, CancellationToken ct)`.

- [ ] **Step 5: Update `PropertyService.cs`:**
  - In `ListCompetitorsAsync`, add `.Where(c => c.ExcludedAt == null)` to the competitors query and map the new fields into `CompetitorDto` (`c.Rating, c.RatingCount, c.Latitude, c.Longitude`).
  - Remove `AddCompetitorAsync`.
  - Add:

```csharp
    public async Task<bool> UntrackCompetitorAsync(Guid competitorId, CancellationToken ct)
    {
        var competitor = await db.Competitors
            .FirstOrDefaultAsync(c => c.Id == competitorId && c.ExcludedAt == null, ct);
        if (competitor is null) return false; // foreign or already excluded
        competitor.ExcludedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }
```

- [ ] **Step 6: Endpoints** in `PropertyEndpoints.cs`: delete the `POST /{propertyId}/competitors` handler and its `CompetitorCreateDto` usage. Add a top-level competitor route (register a new `MapDelete` on a `/competitors` group, or add inside this file):

```csharp
        var competitors = api.MapGroup("/competitors").RequireAuthorization(AuthConstants.ApiPolicy);
        competitors.MapDelete("/{competitorId:guid}", async (
            Guid competitorId, IPropertyService properties, CancellationToken ct) =>
        {
            var ok = await properties.UntrackCompetitorAsync(competitorId, ct);
            return ok ? Results.NoContent() : Results.NotFound();
        });
```

- [ ] **Step 7: Update `openapi.yaml`** — remove `POST /properties/{id}/competitors` and `CompetitorCreate`; add `DELETE /competitors/{id}` (204/404); extend `Competitor` schema with rating/geo and make `sourceUrl` nullable.

- [ ] **Step 8: Run tests + full backend suite**
Run: `cd backend && dotnet build && dotnet test`
Expected: PASS (fix any other test that referenced `AddCompetitorAsync`/`CompetitorCreateDto` — update or delete those cases; note in the commit).

- [ ] **Step 9: Commit**
```bash
git add backend/src shared/contracts/openapi.yaml
git commit -m "feat(api): competitors are discovered - untrack soft-delete, drop manual create"
```

---

### Task 5: Backend — points-of-interest seeder + read endpoint

**Files:**
- Create: `backend/src/PricePilot.Application/IPoiQueries.cs`, `backend/src/PricePilot.Infrastructure/Services/PoiQueries.cs`, `backend/src/PricePilot.Infrastructure/PoiSeeder.cs`
- Modify: `backend/src/PricePilot.Application/Dtos.cs`, `backend/src/PricePilot.Api/Program.cs`, new `backend/src/PricePilot.Api/Endpoints/PoiEndpoints.cs`
- Modify: `shared/contracts/openapi.yaml`
- Test: `backend/tests/PricePilot.UnitTests/PoiTests.cs`

**Interfaces:**
- Produces: `PoiDto(Guid Id, string City, string Name, decimal Latitude, decimal Longitude, int Weight)`; `IPoiQueries.ListByCityAsync(string city, CancellationToken ct) -> IReadOnlyList<PoiDto>`; `PoiSeeder.SeedAsync(AppDbContext db, CancellationToken ct)` idempotent (deterministic GUID per city+name).
- Endpoint: `GET /points-of-interest?city=sibiu` → 200 + `[Poi]` (empty list for unknown city; POIs are public reference data, not tenant-scoped).

- [ ] **Step 1: Write the failing test** — `PoiTests.cs`:

```csharp
[Fact]
public async Task Seeder_is_idempotent_and_endpoint_returns_city_pois()
{
    using var app = TestApi.Create(); // seeder runs at startup OR call PoiSeeder here
    using (var scope = app.Services.CreateScope())
    {
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await PoiSeeder.SeedAsync(db, default);
        await PoiSeeder.SeedAsync(db, default); // second run must not duplicate
        Assert.Equal(5, await db.PointsOfInterest.CountAsync(p => p.City == "sibiu"));
    }
    var client = app.TenantClient(TestApi.TenantA);
    var pois = await client.GetFromJsonAsync<List<JsonElement>>("/api/v1/points-of-interest?city=sibiu");
    Assert.Contains(pois!, p => p.GetProperty("name").GetString() == "Piața Mare");
}
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd backend && dotnet test --filter FullyQualifiedName~PoiTests`
Expected: FAIL — `PoiSeeder`/endpoint absent.

- [ ] **Step 3: Add `PoiDto`** to `Dtos.cs` (shape above). Create `IPoiQueries.cs`:

```csharp
namespace PricePilot.Application;
public interface IPoiQueries
{
    Task<IReadOnlyList<PoiDto>> ListByCityAsync(string city, CancellationToken ct);
}
```

- [ ] **Step 4: Implement `PoiQueries.cs`** (no tenant filter needed — POI is not `ITenantOwned`):

```csharp
using Microsoft.EntityFrameworkCore;
using PricePilot.Application;

namespace PricePilot.Infrastructure.Services;

public sealed class PoiQueries(AppDbContext db) : IPoiQueries
{
    public async Task<IReadOnlyList<PoiDto>> ListByCityAsync(string city, CancellationToken ct)
    {
        var norm = city.Trim().ToLowerInvariant();
        return await db.PointsOfInterest.AsNoTracking()
            .Where(p => p.City == norm)
            .OrderByDescending(p => p.Weight).ThenBy(p => p.Name)
            .Select(p => new PoiDto(p.Id, p.City, p.Name, p.Latitude, p.Longitude, p.Weight))
            .ToListAsync(ct);
    }
}
```

- [ ] **Step 5: Implement `PoiSeeder.cs`** — deterministic id via a name-based GUID (mirror `DemoSeeder`'s fixed-key insert-if-missing style). Use a helper that hashes `"sibiu|Piața Mare"` to a GUID (MD5-derived, like EF's `Guid` from bytes):

```csharp
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;
using System.Text;
using PricePilot.Domain;

namespace PricePilot.Infrastructure;

public static class PoiSeeder
{
    private static readonly (string City, string Name, decimal Lat, decimal Lng, int Weight)[] Seed =
    [
        ("sibiu", "Piața Mare",        45.797300m, 24.152100m, 100),
        ("sibiu", "Piața Mică",        45.798100m, 24.151300m, 90),
        ("sibiu", "Podul Minciunilor", 45.798400m, 24.151000m, 70),
        ("sibiu", "Muzeul Brukenthal", 45.797100m, 24.151700m, 80),
        ("sibiu", "Centru istoric",    45.797600m, 24.151600m, 100),
    ];

    public static async Task SeedAsync(AppDbContext db, CancellationToken ct)
    {
        foreach (var (city, name, lat, lng, weight) in Seed)
        {
            var id = DeterministicId(city, name);
            if (await db.PointsOfInterest.AnyAsync(p => p.Id == id, ct)) continue;
            db.PointsOfInterest.Add(new PointOfInterest
            {
                Id = id, City = city, Name = name, Latitude = lat, Longitude = lng,
                Weight = weight, CreatedAt = DateTimeOffset.UtcNow,
            });
        }
        await db.SaveChangesAsync(ct);
    }

    private static Guid DeterministicId(string city, string name)
    {
        var bytes = MD5.HashData(Encoding.UTF8.GetBytes($"poi|{city}|{name}"));
        return new Guid(bytes);
    }
}
```

> Coordinates above are approximate placeholders good enough for the demo's proximity ordering; refine against Google during live verification (Task 10 human step). They must not be presented as surveyed truth.

- [ ] **Step 6: Wire endpoint + DI.** Create `PoiEndpoints.cs`:

```csharp
using PricePilot.Api.Auth;
using PricePilot.Application;

namespace PricePilot.Api.Endpoints;

public static class PoiEndpoints
{
    public static void MapPoiEndpoints(this IEndpointRouteBuilder api)
    {
        api.MapGet("/points-of-interest", async (string city, IPoiQueries pois, CancellationToken ct) =>
                string.IsNullOrWhiteSpace(city)
                    ? Results.BadRequest(new { error = "city is required" })
                    : Results.Ok(await pois.ListByCityAsync(city, ct)))
            .RequireAuthorization(AuthConstants.ApiPolicy);
    }
}
```

In `Program.cs`: register `builder.Services.AddScoped<IPoiQueries, PoiQueries>();`, call `app.MapPoiEndpoints();`, and run `PoiSeeder.SeedAsync` where `DemoSeeder` runs (Development startup, after migrations).

- [ ] **Step 7: Update `openapi.yaml`** — add `Poi` schema + `GET /points-of-interest`.

- [ ] **Step 8: Run tests**
Run: `cd backend && dotnet build && dotnet test --filter FullyQualifiedName~PoiTests`
Expected: PASS.

- [ ] **Step 9: Commit**
```bash
git add backend/src shared/contracts/openapi.yaml
git commit -m "feat(api): points-of-interest seed + read endpoint"
```

---

### Task 6: Dataplane — `PlacesProvider` seam + adapters + config + fixtures

**Files:**
- Create: `dataplane/src/pricepilot/places/__init__.py`, `models.py`, `provider.py`, `google.py`, `fixture.py`, `capture.py`
- Modify: `dataplane/src/pricepilot/config.py`, root `.env.example`
- Create: `dataplane/tests/fixtures/places/text_search_continental.json`, `nearby_lodging_sibiu.json`; `dataplane/tests/test_places_provider.py`

**Interfaces:**
- Produces:
  - `PlaceCandidate` dataclass: `place_id: str`, `name: str`, `formatted_address: str | None`, `latitude: Decimal`, `longitude: Decimal`, `rating: Decimal | None`, `rating_count: int | None`; method `to_dict()` → JSON-ready dict (Decimals as strings? No — numbers via the engine's `to_jsonable` convention: quantized floats). Use `float` only in `to_dict()`, never in computation.
  - `PlacesProvider` Protocol: `text_search(query, *, city) -> list[PlaceCandidate]`, `details(place_id) -> PlaceCandidate`, `nearby(lat, lng, *, radius_m, kind="lodging") -> list[PlaceCandidate]`.
  - `get_places_provider() -> PlacesProvider` — returns `GoogleAdapter` or `FixtureAdapter` per `settings.places_provider`.
  - `GoogleAdapter(api_key, *, http_get=None)` and `FixtureAdapter(fixture_dir)` both satisfy the Protocol.
- Consumes: nothing from other tasks (leaf module). Later tasks 7/8 import `get_places_provider`, `PlaceCandidate`.

- [ ] **Step 1: Add config** to `config.py` (`Settings`):

```python
    places_provider: str = "fixture"        # "google" | "fixture"
    google_places_api_key: str = ""
    competitor_discovery_radius_m: int = 1500
    competitor_discovery_max: int = 15
```

Document all four in `.env.example` with the defaults + a note that `fixture` never calls live.

- [ ] **Step 2: Write the failing test** — `tests/test_places_provider.py`. Drive `FixtureAdapter` against saved JSON and the `GoogleAdapter` parser against a fixture via injected `http_get` (never live). First author the fixtures (minimal Google-shaped JSON):

`tests/fixtures/places/text_search_continental.json` (trimmed Google Places Text Search response — 2 results). `tests/fixtures/places/nearby_lodging_sibiu.json` (3 lodging results). Then:

```python
from decimal import Decimal
from pricepilot.places.fixture import FixtureAdapter
from pricepilot.places.google import GoogleAdapter

def test_fixture_text_search_returns_candidates(fixtures_dir):
    provider = FixtureAdapter(fixtures_dir / "places")
    results = provider.text_search("Continental Forum", city="sibiu")
    assert results[0].place_id
    assert isinstance(results[0].latitude, Decimal)
    assert results[0].rating is None or isinstance(results[0].rating, Decimal)

def test_google_adapter_parses_text_search_without_network(fixtures_dir):
    payload = (fixtures_dir / "places" / "text_search_continental.json").read_text()
    def fake_get(url: str) -> str:  # injected; no network
        return payload
    provider = GoogleAdapter(api_key="test", http_get=fake_get)
    results = provider.text_search("Continental Forum", city="sibiu")
    assert len(results) == 2
    assert results[0].rating == Decimal("4.4")
```

- [ ] **Step 3: Run to verify it fails**
Run: `cd dataplane && .venv\Scripts\python -m pytest tests/test_places_provider.py`
Expected: FAIL — `pricepilot.places` does not exist.

- [ ] **Step 4: Implement `models.py`:**

```python
from dataclasses import dataclass
from decimal import Decimal
from typing import Any


@dataclass(frozen=True)
class PlaceCandidate:
    place_id: str
    name: str
    formatted_address: str | None
    latitude: Decimal
    longitude: Decimal
    rating: Decimal | None
    rating_count: int | None

    def to_dict(self) -> dict[str, Any]:
        """JSON-ready (backend stores this array as place_candidates JSONB).

        Coordinates/rating cross the JSON boundary as numbers; Decimals are the
        source of truth (see engine/serialization). Floats live only here.
        """
        return {
            "place_id": self.place_id,
            "name": self.name,
            "formatted_address": self.formatted_address,
            "latitude": float(self.latitude),
            "longitude": float(self.longitude),
            "rating": None if self.rating is None else float(self.rating),
            "rating_count": self.rating_count,
        }
```

- [ ] **Step 5: Implement `provider.py`** (Protocol) and a shared parse helper:

```python
from decimal import Decimal
from typing import Protocol

from pricepilot.places.models import PlaceCandidate


class PlacesProvider(Protocol):
    def text_search(self, query: str, *, city: str) -> list[PlaceCandidate]: ...
    def details(self, place_id: str) -> PlaceCandidate: ...
    def nearby(self, lat: Decimal, lng: Decimal, *, radius_m: int,
               kind: str = "lodging") -> list[PlaceCandidate]: ...


def candidate_from_google_result(result: dict) -> PlaceCandidate:
    """Map one Google Places result object to a PlaceCandidate (pure)."""
    loc = result["geometry"]["location"]
    rating = result.get("rating")
    return PlaceCandidate(
        place_id=result["place_id"],
        name=result.get("name", ""),
        formatted_address=result.get("formatted_address") or result.get("vicinity"),
        latitude=Decimal(str(loc["lat"])),
        longitude=Decimal(str(loc["lng"])),
        rating=None if rating is None else Decimal(str(rating)),
        rating_count=result.get("user_ratings_total"),
    )
```

- [ ] **Step 6: Implement `google.py`** — all HTTP through an injectable `http_get` (defaults to a `PoliteClient`-style httpx call). Never called in tests:

```python
import json
from decimal import Decimal
from typing import Callable
from urllib.parse import urlencode

from pricepilot.places.models import PlaceCandidate
from pricepilot.places.provider import candidate_from_google_result

_TEXT = "https://maps.googleapis.com/maps/api/place/textsearch/json"
_NEARBY = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
_DETAILS = "https://maps.googleapis.com/maps/api/place/details/json"


class GoogleAdapter:
    def __init__(self, api_key: str, *, http_get: Callable[[str], str] | None = None):
        self._key = api_key
        self._get = http_get or _default_get

    def text_search(self, query: str, *, city: str) -> list[PlaceCandidate]:
        url = f"{_TEXT}?{urlencode({'query': f'{query}, {city}', 'key': self._key})}"
        body = json.loads(self._get(url))
        return [candidate_from_google_result(r) for r in body.get("results", [])]

    def nearby(self, lat: Decimal, lng: Decimal, *, radius_m: int,
               kind: str = "lodging") -> list[PlaceCandidate]:
        url = f"{_NEARBY}?{urlencode({'location': f'{lat},{lng}', 'radius': radius_m, 'type': kind, 'key': self._key})}"
        body = json.loads(self._get(url))
        return [candidate_from_google_result(r) for r in body.get("results", [])]

    def details(self, place_id: str) -> PlaceCandidate:
        url = f"{_DETAILS}?{urlencode({'place_id': place_id, 'key': self._key})}"
        body = json.loads(self._get(url))
        return candidate_from_google_result(body["result"])


def _default_get(url: str) -> str:
    import httpx
    resp = httpx.get(url, timeout=20.0)
    resp.raise_for_status()
    return resp.text
```

- [ ] **Step 7: Implement `fixture.py`** (tests + demo). Deterministic: text_search reads `text_search_<slug>.json` or a single default; nearby reads `nearby_lodging_<city>.json`:

```python
import json
from decimal import Decimal
from pathlib import Path

from pricepilot.places.models import PlaceCandidate
from pricepilot.places.provider import candidate_from_google_result


class FixtureAdapter:
    def __init__(self, fixture_dir: Path):
        self._dir = Path(fixture_dir)

    def _load(self, filename: str) -> list[PlaceCandidate]:
        body = json.loads((self._dir / filename).read_text(encoding="utf-8"))
        return [candidate_from_google_result(r) for r in body.get("results", [])]

    def text_search(self, query: str, *, city: str) -> list[PlaceCandidate]:
        # Single canonical fixture for the demo hotel; deterministic.
        return self._load("text_search_continental.json")

    def nearby(self, lat: Decimal, lng: Decimal, *, radius_m: int,
               kind: str = "lodging") -> list[PlaceCandidate]:
        return self._load(f"nearby_{kind}_sibiu.json")

    def details(self, place_id: str) -> PlaceCandidate:
        for c in self._load("text_search_continental.json"):
            if c.place_id == place_id:
                return c
        raise KeyError(place_id)
```

- [ ] **Step 8: Implement `__init__.py`** with the factory:

```python
from pathlib import Path

from pricepilot.config import get_settings
from pricepilot.places.fixture import FixtureAdapter
from pricepilot.places.google import GoogleAdapter
from pricepilot.places.models import PlaceCandidate
from pricepilot.places.provider import PlacesProvider

_FIXTURE_DIR = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "places"


def get_places_provider() -> PlacesProvider:
    settings = get_settings()
    if settings.places_provider == "google":
        if not settings.google_places_api_key:
            raise RuntimeError("PLACES_PROVIDER=google requires GOOGLE_PLACES_API_KEY")
        return GoogleAdapter(settings.google_places_api_key)
    return FixtureAdapter(_FIXTURE_DIR)


__all__ = ["PlaceCandidate", "PlacesProvider", "get_places_provider"]
```

- [ ] **Step 9: Implement `capture.py`** — a tiny CLI mirroring `scrapers/capture` that hits live Google once (real key) and writes the raw JSON into `tests/fixtures/places/` for the demo. Human-in-the-loop; not run in CI:

```python
"""Capture one live Google Places response as a fixture (human-in-the-loop).

Usage (needs GOOGLE_PLACES_API_KEY + PLACES_PROVIDER=google):
    python -m pricepilot.places.capture text "Hotel Continental Forum" --city sibiu
    python -m pricepilot.places.capture nearby --lat 45.79 --lng 24.15
"""
import argparse
import json
from urllib.request import urlopen

from pricepilot.config import get_settings
# ... argparse wiring that builds the same URLs as GoogleAdapter and writes the
# raw response text under tests/fixtures/places/. Keep it dependency-light.
```

(Flesh out argparse to write `text_search_<slug>.json` / `nearby_lodging_<city>.json`. It only runs manually with a real key.)

- [ ] **Step 10: Run tests + lint**
Run: `cd dataplane && .venv\Scripts\python -m pytest tests/test_places_provider.py && .venv\Scripts\python -m ruff check src tests`
Expected: PASS + clean.

- [ ] **Step 11: Commit**
```bash
git add dataplane/src/pricepilot/places dataplane/src/pricepilot/config.py dataplane/tests/fixtures/places dataplane/tests/test_places_provider.py .env.example
git commit -m "feat(dataplane): PlacesProvider seam - Google + fixture adapters"
```

---

### Task 7: Dataplane — `resolve_place` job handler

**Files:**
- Modify: `dataplane/src/pricepilot/scheduler/jobs.py`
- Test: `dataplane/tests/test_place_jobs.py`

**Interfaces:**
- Consumes: `get_places_provider`, `PlaceCandidate` (Task 6); `Property`, `Job` mappings (Task 1); `enqueue_job` (existing, `jobs.py:100`).
- Produces: `handle_resolve_place(session, payload, *, provider=None) -> dict[str, Any]` in `HANDLERS["resolve_place"]`. Writes property place fields + `place_candidates` (top 5), sets `place_resolved_at`; on no match writes `place_candidates="__failed__"` sentinel (matches backend Task 2 Step 6) and leaves `place_resolved_at` null; on success enqueues `discover_competitors`.

- [ ] **Step 1: Write the failing test** — `tests/test_place_jobs.py`. Use an in-memory-ish fake provider + a real `Session` against the integration DB is heavy; instead unit-test the handler with a fake `Session`? These handlers use SQLAlchemy `session.execute`. Follow the pattern of existing handler tests (they use a real session via the `integration` fixtures OR a lightweight session). Use the existing test DB fixture used by `test_jobs`-style tests. Cases:

```python
from decimal import Decimal
from pricepilot.places.models import PlaceCandidate
from pricepilot.scheduler.jobs import handle_resolve_place

class FakeProvider:
    def __init__(self, results): self._results = results
    def text_search(self, query, *, city): return self._results
    def nearby(self, *a, **k): return []
    def details(self, place_id): raise KeyError

def test_resolve_writes_place_fields_and_enqueues_discovery(db_session, seed_property):
    prop = seed_property(name="Hotel X", city="sibiu")   # helper inserts a Property
    provider = FakeProvider([
        PlaceCandidate("ChIJ1", "Hotel X", "Str. 1", Decimal("45.79"), Decimal("24.15"), Decimal("4.4"), 1280),
        PlaceCandidate("ChIJ2", "Hotel Y", "Str. 2", Decimal("45.80"), Decimal("24.16"), Decimal("4.1"), 300),
    ])
    result = handle_resolve_place(db_session, {"property_id": str(prop.id)}, provider=provider)
    assert result["resolved"] is True
    row = db_session.get(Property, prop.id)
    assert row.place_id == "ChIJ1"
    assert row.rating == Decimal("4.4")
    assert row.place_resolved_at is not None
    assert len(row.place_candidates) == 2
    # discovery enqueued
    assert db_session.execute(select(func.count()).select_from(Job)
        .where(Job.type == "discover_competitors")).scalar() == 1

def test_resolve_no_match_sets_failed_sentinel(db_session, seed_property):
    prop = seed_property(name="Nonexistent", city="sibiu")
    result = handle_resolve_place(db_session, {"property_id": str(prop.id)}, provider=FakeProvider([]))
    assert result["resolved"] is False
    row = db_session.get(Property, prop.id)
    assert row.place_candidates == "__failed__"
    assert row.place_resolved_at is None
```

> If the repo's handler tests run only under the `integration` marker (real Postgres), place these there and mark accordingly; otherwise use the existing lightweight session fixture. Match whatever `test_*jobs*`/`tests/integration` already do — do not invent a new DB harness.

- [ ] **Step 2: Run to verify it fails**
Run: `cd dataplane && .venv\Scripts\python -m pytest tests/test_place_jobs.py -k resolve`
Expected: FAIL — `handle_resolve_place` undefined.

- [ ] **Step 3: Implement the handler** in `jobs.py` (add imports: `from pricepilot.places import get_places_provider, PlaceCandidate` and the `Property` model is already imported):

```python
#: How many search candidates to stash for the correction picker.
PLACE_CANDIDATE_LIMIT = 5


def handle_resolve_place(
    session: Session,
    payload: dict[str, Any],
    *,
    provider: Any = None,
) -> dict[str, Any]:
    """Resolve a property to a Google place; write geo/rating + candidates.

    Idempotent: re-running re-resolves and overwrites. On a match, the top
    result populates the place columns, the top ``PLACE_CANDIDATE_LIMIT`` are
    stashed for the correction picker, and ``discover_competitors`` is enqueued.
    On no match, the ``"__failed__"`` sentinel goes into ``place_candidates``
    and ``place_resolved_at`` stays null (backend derives place_status='failed').
    ``provider`` is injectable for tests; production uses ``get_places_provider()``.
    """
    property_id = _parse_uuid(payload.get("property_id"))
    if property_id is None:
        raise ValueError("resolve_place requires property_id")
    prop = session.get(Property, property_id)
    if prop is None:
        return {"resolved": False, "reason": "property not found"}

    query = (payload.get("query") or f"{prop.name}").strip()
    active = provider if provider is not None else get_places_provider()
    candidates: list[PlaceCandidate] = active.text_search(query, city=prop.city)

    if not candidates:
        session.execute(
            update(Property).where(Property.id == property_id).values(
                place_candidates="__failed__", place_resolved_at=None,
            )
        )
        session.commit()
        return {"resolved": False, "reason": f"no match for {query!r}"}

    top = candidates[0]
    stash = [c.to_dict() for c in candidates[:PLACE_CANDIDATE_LIMIT]]
    session.execute(
        update(Property).where(Property.id == property_id).values(
            place_id=top.place_id,
            latitude=top.latitude,
            longitude=top.longitude,
            rating=top.rating,
            rating_count=top.rating_count,
            place_resolved_at=func.now(),
            place_candidates=stash,
        )
    )
    enqueue_job(session, "discover_competitors", {"property_id": str(property_id)})
    session.commit()
    return {
        "property_id": str(property_id),
        "resolved": True,
        "place_id": top.place_id,
        "candidate_count": len(stash),
    }
```

> `place_candidates` is a JSONB column mapped as `dict[str, Any]`, but SQLAlchemy persists whatever Python object you assign — a `list[dict]` serializes to a JSON array, and the `"__failed__"` string serializes to a JSON string. Both are valid JSONB. The backend reads the array via `DeserializeCandidates` and treats the bare string as the failure sentinel.

- [ ] **Step 4: Register** in `HANDLERS`: `"resolve_place": handle_resolve_place,`. Note: `HANDLERS` values are `Callable[[Session, dict], dict]`; the extra keyword-only `provider` defaults to `None`, so the registry call site (`HANDLERS[type](session, payload)`) still type-checks — verify the poller invokes handlers positionally (it does: `jobs.py` poller calls `handler(session, payload)`).

- [ ] **Step 5: Run tests + lint**
Run: `cd dataplane && .venv\Scripts\python -m pytest tests/test_place_jobs.py -k resolve && .venv\Scripts\python -m ruff check src tests`
Expected: PASS + clean.

- [ ] **Step 6: Commit**
```bash
git add dataplane/src/pricepilot/scheduler/jobs.py dataplane/tests/test_place_jobs.py
git commit -m "feat(dataplane): resolve_place job - resolve property to google place"
```

---

### Task 8: Dataplane — `discover_competitors` job handler

**Files:**
- Modify: `dataplane/src/pricepilot/scheduler/jobs.py`
- Test: `dataplane/tests/test_place_jobs.py` (add cases)

**Interfaces:**
- Consumes: `get_places_provider`, `PlaceCandidate` (Task 6); `Property`, `Competitor` (Task 1); `settings.competitor_discovery_radius_m/max`.
- Produces: `handle_discover_competitors(session, payload, *, provider=None) -> dict[str, Any]` in `HANDLERS["discover_competitors"]`. Upserts competitor rows keyed by `uuid5(NAMESPACE, place_id)`; excludes the property's own `place_id` and any existing row with `excluded_at` set (tombstone — do NOT re-add); caps at `competitor_discovery_max`, logging overflow.

- [ ] **Step 1: Write the failing test** — add to `tests/test_place_jobs.py`:

```python
import uuid
from pricepilot.scheduler.jobs import handle_discover_competitors, DISCOVERY_NS

def test_discover_upserts_and_skips_self_and_tombstoned(db_session, seed_property):
    prop = seed_property(name="Hotel X", city="sibiu", place_id="ChIJ_self",
                         latitude=Decimal("45.79"), longitude=Decimal("24.15"))
    # Pre-tombstone one nearby place so discovery must skip it.
    excluded_id = uuid.uuid5(DISCOVERY_NS, "ChIJ_excluded")
    db_session.add(Competitor(id=excluded_id, tenant_id=prop.tenant_id, property_id=prop.id,
                              name="Old Hotel", place_id="ChIJ_excluded",
                              excluded_at=_utcnow(), discovery_source="google_nearby"))
    db_session.commit()

    provider = FakeNearby([
        PlaceCandidate("ChIJ_self", "Hotel X", None, Decimal("45.79"), Decimal("24.15"), Decimal("4.4"), 10),
        PlaceCandidate("ChIJ_a", "Hotel A", None, Decimal("45.80"), Decimal("24.16"), Decimal("4.1"), 50),
        PlaceCandidate("ChIJ_excluded", "Old Hotel", None, Decimal("45.81"), Decimal("24.17"), Decimal("3.9"), 20),
    ])
    result = handle_discover_competitors(db_session, {"property_id": str(prop.id)}, provider=provider)
    assert result["discovered"] == 1          # only Hotel A
    assert result["skipped_excluded"] == 1     # the tombstoned one
    names = [c.name for c in db_session.execute(
        select(Competitor).where(Competitor.property_id == prop.id,
                                 Competitor.excluded_at.is_(None))).scalars()]
    assert names == ["Hotel A"]

def test_discover_is_idempotent(db_session, seed_property):
    prop = seed_property(name="Hotel X", city="sibiu", place_id="ChIJ_self",
                         latitude=Decimal("45.79"), longitude=Decimal("24.15"))
    provider = FakeNearby([PlaceCandidate("ChIJ_a", "Hotel A", None,
                           Decimal("45.80"), Decimal("24.16"), Decimal("4.1"), 50)])
    handle_discover_competitors(db_session, {"property_id": str(prop.id)}, provider=provider)
    handle_discover_competitors(db_session, {"property_id": str(prop.id)}, provider=provider)
    count = db_session.execute(select(func.count()).select_from(Competitor)
        .where(Competitor.property_id == prop.id)).scalar()
    assert count == 1   # uuid5 key => second run updates, no duplicate
```

(`FakeNearby` mirrors `FakeProvider` but returns its list from `nearby`.)

- [ ] **Step 2: Run to verify it fails**
Run: `cd dataplane && .venv\Scripts\python -m pytest tests/test_place_jobs.py -k discover`
Expected: FAIL — `handle_discover_competitors`/`DISCOVERY_NS` undefined.

- [ ] **Step 3: Implement the handler** in `jobs.py`:

```python
import uuid
from pricepilot.config import get_settings

#: Namespace for deterministic competitor ids derived from a Google place_id.
DISCOVERY_NS = uuid.UUID("6f9619ff-8b86-d011-b42d-00cf4fc964ff")


def handle_discover_competitors(
    session: Session,
    payload: dict[str, Any],
    *,
    provider: Any = None,
) -> dict[str, Any]:
    """Auto-discover nearby lodging competitors from a resolved property.

    Idempotent: each competitor's id is ``uuid5(DISCOVERY_NS, place_id)`` so a
    re-run updates in place. The property's own place is skipped; any place
    whose competitor row is tombstoned (``excluded_at`` set) is left removed —
    the owner's untrack is permanent. Capped at
    ``settings.competitor_discovery_max`` (overflow logged, never silently
    dropped). No-op with a reason if the property is unresolved.
    """
    settings = get_settings()
    property_id = _parse_uuid(payload.get("property_id"))
    prop = session.get(Property, property_id) if property_id else None
    if prop is None:
        return {"discovered": 0, "reason": "property not found"}
    if prop.latitude is None or prop.longitude is None:
        return {"discovered": 0, "reason": "property not resolved (no coordinates)"}

    active = provider if provider is not None else get_places_provider()
    found = active.nearby(
        prop.latitude, prop.longitude,
        radius_m=settings.competitor_discovery_radius_m, kind="lodging",
    )

    # Existing rows for this property, keyed by place_id, to honor tombstones.
    existing = {
        c.place_id: c
        for c in session.execute(
            select(Competitor).where(Competitor.property_id == prop.id)
        ).scalars()
        if c.place_id is not None
    }

    discovered = skipped_excluded = capped = 0
    for candidate in found:
        if candidate.place_id == prop.place_id:
            continue  # never track yourself
        row = existing.get(candidate.place_id)
        if row is not None and row.excluded_at is not None:
            skipped_excluded += 1
            continue  # tombstoned: owner's removal is permanent
        if row is None and discovered >= settings.competitor_discovery_max:
            capped += 1
            continue
        cid = uuid.uuid5(DISCOVERY_NS, candidate.place_id)
        session.execute(
            insert(Competitor).values(
                id=cid, tenant_id=prop.tenant_id, property_id=prop.id,
                name=candidate.name, source_url=None,
                place_id=candidate.place_id,
                latitude=candidate.latitude, longitude=candidate.longitude,
                rating=candidate.rating, rating_count=candidate.rating_count,
                discovered_at=func.now(), discovery_source="google_nearby",
                created_at=func.now(),
            ).on_conflict_do_update(
                index_elements=[Competitor.id],
                set_={
                    "name": candidate.name,
                    "latitude": candidate.latitude,
                    "longitude": candidate.longitude,
                    "rating": candidate.rating,
                    "rating_count": candidate.rating_count,
                    "discovered_at": func.now(),
                },
            )
        )
        if row is None:
            discovered += 1
    if capped:
        logger.info("discover_competitors: capped %d beyond max=%d for property %s",
                    capped, settings.competitor_discovery_max, prop.id)
    session.commit()
    return {"property_id": str(prop.id), "discovered": discovered,
            "skipped_excluded": skipped_excluded, "capped": capped}
```

Add the import: `from sqlalchemy.dialects.postgresql import insert` (the `on_conflict_do_update` upsert needs the PG-specific `insert`; alias to avoid clashing with the generic `insert` already imported — e.g. `from sqlalchemy.dialects.postgresql import insert as pg_insert` and use `pg_insert(Competitor)`). Update the code accordingly.

> Competitor rows carry `tenant_id` (from the property) but are written by the dataplane here. This is the ONE place the dataplane writes a tenant-owned table; note it in `table-ownership.md` (`competitors` row: "backend writes owner edits; dataplane writes auto-discovered rows via discover_competitors, copying tenant_id from the parent property"). Add that note in this task's commit.

- [ ] **Step 4: Register** in `HANDLERS`: `"discover_competitors": handle_discover_competitors,`.

- [ ] **Step 5: Run tests + lint**
Run: `cd dataplane && .venv\Scripts\python -m pytest tests/test_place_jobs.py && .venv\Scripts\python -m ruff check src tests`
Expected: PASS + clean.

- [ ] **Step 6: Commit**
```bash
git add dataplane/src/pricepilot/scheduler/jobs.py dataplane/tests/test_place_jobs.py shared/contracts/table-ownership.md
git commit -m "feat(dataplane): discover_competitors job - auto-discover nearby lodging"
```

---

### Task 9: Web — types, hooks, add/resolve/correct property, discovered competitors

**Dispatched to the `implementer` agent (web/ only). Read first:** `web/CLAUDE.md`, this task, the spec's "Web UX" section, `shared/contracts/openapi.yaml` (updated by Tasks 2–5), existing `SettingsPage.tsx`, `CompetitorsPage.tsx`, `src/api/hooks.ts`, `src/api/types.ts`, `src/components/States.tsx`, `src/styles/global.css` tokens.

**Files:**
- Modify: `web/src/api/types.ts`, `web/src/api/hooks.ts`, `web/src/features/settings/SettingsPage.tsx`, `web/src/features/competitors/CompetitorsPage.tsx`, `web/src/styles/global.css` (tokens only if needed)
- Test: co-located `*.test.tsx` for each flow (mocked fetch, mirror existing web tests)

**Deliverables:**

1. **`types.ts`** — mirror the updated openapi: extend `Property` with `latitude?, longitude?, rating?, ratingCount?, placeStatus: 'unresolved'|'resolved'|'failed', placeCandidates: PlaceCandidate[]`; add `PlaceCandidate` (`placeId, name, formattedAddress?, latitude?, longitude?, rating?, ratingCount?`); extend `Competitor` with `rating?, ratingCount?, latitude?, longitude?` and make `sourceUrl` optional; remove `CompetitorCreate`; add `PlacePick { placeId: string }` and `ResolvePlace { query?: string }`.

2. **`hooks.ts`** — add:
   - `useCreateProperty()` — `POST /properties`, invalidates `['properties']`.
   - `usePickPlace()` — `PATCH /properties/{id}/place`, invalidates `['properties']`.
   - `useResolveProperty()` — `POST /properties/{id}/resolve-place`, invalidates `['properties']` (and `['jobs']`).
   - `useUntrackCompetitor()` — `DELETE /competitors/{id}`, invalidates `['competitors']`.
   Follow the mutation shape in `useUpdateRecommendationStatus` (`hooks.ts:62`).

3. **Settings** — one primary "Add your property" form (name + city only). After create, the property card shows:
   - `placeStatus==='unresolved'` → a "Finding your place on Google…" resolving state (poll `['properties']` via react-query `refetchInterval` while unresolved).
   - `resolved` → name, `formattedAddress`/city, ★`rating` (`ratingCount` reviews), small static map pin placeholder (no map lib — a labeled coordinate chip is fine).
   - `failed` → "We couldn't find it" + the re-search box.
   - A "Not the right place?" control listing `placeCandidates` (radio, name + address + rating) → `usePickPlace`, plus a "Search by a different name" text box → `useResolveProperty`.

4. **Competitors page** — read-only discovered list: name, ★rating + review count, distance if derivable (else omit — do not compute money/precision client-side beyond a simple haversine on provided coords for display). Each row an **Untrack** button → confirm dialog ("This competitor stays removed from your tracking.") → `useUntrackCompetitor`. Remove any "add competitor" form.

5. **Tests** — every flow with mocked fetch: create → resolving → resolved; pick candidate; re-search; untrack (incl. confirm); loading/failed/empty states. All suites + typecheck + build green; no new deps; watercolor tokens only; a11y (labels, ≥44px, visible focus, ≥16px text).

**Verify:** `cd web && npm test -- --run && npm run typecheck && npm run build` all green.

**Commit:** `feat(web): enter property by name, google resolution + correction, discovered competitors`

---

### Task 10: Verification + docs closeout

**Files:** `docs/demo.md`, `docs/roadmap.md`, memory update; no code unless a fix is needed.

- [ ] **Step 1: Apply the migration to the dev DB (HUMAN-IN-THE-LOOP — agents are permission-blocked from dev-DB writes).** With Postgres up (`docker compose up -d db`):
```bash
cd backend && dotnet tool run dotnet-ef database update \
  --project src/PricePilot.Infrastructure --startup-project src/PricePilot.Api \
  --connection "Host=localhost;Port=5432;Database=pricepilot;Username=pricepilot;Password=devpassword"
```

- [ ] **Step 2: Dataplane schema-sync + full suite against the migrated dev DB.**
```bash
cd dataplane && $env:DATABASE_URL="postgresql+psycopg://pricepilot:devpassword@localhost:5432/pricepilot"
.venv\Scripts\python -m pytest    # includes tests/integration/test_schema_sync.py
```
Expected: green (schema-sync confirms `tables.py` matches the migrated schema).

- [ ] **Step 3: Full suites, all three runtimes.**
```bash
cd backend && dotnet build && dotnet test
cd ../dataplane && .venv\Scripts\python -m pytest && .venv\Scripts\python -m ruff check src tests
cd ../web && npm test -- --run && npm run typecheck && npm run build
```
Show output for each. Fix any red before proceeding.

- [ ] **Step 4: Manual API smoke (fixture provider) against the dev stack.** With `PLACES_PROVIDER=fixture` and the dataplane worker running: `POST /properties {name:"Hotel Continental Forum", city:"sibiu"}` → poll `GET /properties` until `placeStatus==="resolved"` (rating populated) → `GET /properties/{id}/competitors` shows the fixture's nearby lodging. Verify in psql that `properties.place_id` and discovered `competitors.rating` are set.

- [ ] **Step 5: (Optional, HUMAN, real key) capture a real demo fixture.** With `PLACES_PROVIDER=google` + `GOOGLE_PLACES_API_KEY`: `python -m pricepilot.places.capture text "<a real Sibiu hotel>" --city sibiu` and `... nearby --lat <r> --lng <r>`; commit the sanitized fixtures so the demo replays real data. Refine the POI coordinates (Task 5) against Google while here.

- [ ] **Step 6: Code review.** Dispatch the `code-reviewer` agent on the full branch diff (tenant isolation on the new dataplane competitor write, contract drift across the four contract files, money/decimal on coordinates, no live calls in tests). Address findings.

- [ ] **Step 7: Docs + memory.** Add the enter-property → resolve → discover walkthrough to `docs/demo.md`; add a wave/section to `docs/roadmap.md` (foundation landed; reviews + proximity rules + account signup remain). Update the project memory. Commit `docs: google places foundation closeout`.

## Self-Review (author)

- **Spec coverage:** schema (T1) ✓; provider seam + Google/fixture adapters + config + capture (T6) ✓; resolve_place (T7) ✓; discover_competitors + tombstone + cap (T8) ✓; POI seed + read (T5) ✓; enter-by-name + place fields/status (T2) ✓; correction pick + re-resolve (T3) ✓; untrack soft-delete + drop manual create (T4) ✓; web UX (T9) ✓; demo/fixtures/docs + contracts (T2/T6/T10) ✓; reviews/proximity rules + account signup explicitly deferred (not in plan) ✓.
- **Type consistency:** `place_candidates` array of `PlaceCandidateDto`/`PlaceCandidate.to_dict()` keys (`place_id,name,formatted_address,latitude,longitude,rating,rating_count`) match backend `PlaceCandidateDto` (Web-cased in JSON via `JsonSerializerDefaults.Web`). `"__failed__"` sentinel agreed across T2 (read) and T7 (write). `resolve_place`/`discover_competitors` job strings identical in `JobTypes`, `jobs.md`, and `HANDLERS`. `uuid5(DISCOVERY_NS, place_id)` used consistently in T8 test + impl.
- **Placeholder scan:** POI coordinates flagged as approximate-to-refine (not a code placeholder); capture CLI argparse body intentionally sketched (human-only tool) with explicit behavior stated. No TBD/TODO in shipped code paths.
- **Human-in-the-loop:** dev-DB migration apply (T10.1) and live Google capture (T10.5) called out as owner steps — agents are permission-blocked from dev-DB writes (per project history).
