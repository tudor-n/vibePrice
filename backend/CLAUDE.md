# backend/ — agent guide

ASP.NET Core 9 (net9.0) API. Owns auth, tenants, properties, serving recommendations,
and the **entire DB schema** (all EF Core migrations live here — the Python dataplane
never emits DDL). Root contracts: `../shared/contracts/` — treat them as law.

## Project layout

| Project | Role | May depend on |
|---|---|---|
| `src/PricePilot.Domain` | Entities + enums (`ITenantOwned`, `Recommendation.TryTransitionTo`, …) | nothing (zero deps by design) |
| `src/PricePilot.Application` | DTOs + service interfaces (`ITenantContext`, `IPropertyService`, `IRecommendationQueries`, `IJobDispatcher`, `IEventQueries`, `JobTypes`) | Domain |
| `src/PricePilot.Infrastructure` | EF Core + Npgsql: `AppDbContext`, migrations, service implementations | Domain, Application |
| `src/PricePilot.Connectors` | Future seams: `INotificationConnector`, `IChannelConnector` + no-op stubs | Domain |
| `src/PricePilot.Api` | Minimal APIs (`Endpoints/`), auth wiring, DI composition root | everything above |
| `tests/PricePilot.UnitTests` | xUnit: domain rules, tenant filter (SQLite in-memory), connector DI | src/* |
| `tests/PricePilot.IntegrationTests` | Postgres-backed tests; currently one skipped placeholder | Infrastructure |

## Layering rules (review-blockers)

- **Domain has no dependencies.** Not even Microsoft.* packages.
- **Api never touches `AppDbContext` directly.** Endpoints call Application interfaces;
  the EF implementations live in `Infrastructure/Services/`.
- Application defines interfaces + DTOs only; Infrastructure implements them.
- Connectors are no-op stubs on purpose (v1 seams) — keep them side-effect free until
  the real feature ships.

## Commands

```bash
cd backend
dotnet build          # TreatWarningsAsErrors: warnings fail the build
dotnet test           # unit tests must stay green; integration suite needs Postgres
dotnet run --project src/PricePilot.Api   # http://localhost:8080 (Development)

# Migrations use the local tool manifest (.config/dotnet-tools.json):
dotnet tool restore
dotnet tool run dotnet-ef migrations add <Name> \
  --project src/PricePilot.Infrastructure --startup-project src/PricePilot.Api
```

Design-time DB access uses `DesignTimeDbContextFactory` (hardcoded local dev connection
string; never used at runtime).

## Conventions

- File-scoped namespaces; `record` for DTOs and messages; primary constructors where natural.
- **Money is `decimal`** (`numeric(10,2)` + `char(3)` currency in Postgres). Never double/float.
- **Stay dates are `DateOnly`**; instants are `DateTimeOffset` UTC → `timestamptz`, named `*_at`.
- Enums (`RecommendationStatus`, `JobStatus`) are stored as **lowercase strings**.
- snake_case identifiers come from `UseSnakeCaseNamingConvention()` (EFCore.NamingConventions) —
  never hand-write `[Column]` attributes for casing.
- JSONB columns: `recommendations.factors`, `jobs.payload`, `jobs.result` (mapped as `string`,
  surfaced as `JsonElement` in DTOs).
- Job types are the four constants in `JobTypes` — new types require updating
  `shared/contracts/jobs.md` first.

## Tenant isolation (hard rules)

- Every `ITenantOwned` entity (User, Property, RoomType, Competitor, Recommendation,
  OwnBooking) has a **global query filter** in `AppDbContext` bound to `ITenantContext`.
  Unresolved tenant ⇒ filter matches nothing (no leak by default).
- **Never call `IgnoreQueryFilters()`** outside dedicated admin code.
- Endpoints taking an id must verify ownership; the pattern used here is "look it up
  through the filtered context and 404 when absent" (see `RecommendationQueries.UpdateStatusAsync`,
  `PropertyService.AddCompetitorAsync`).
- New writes must set `TenantId` from `ITenantContext`, never from request bodies.
- TODO(auth): `DevHeaderTenantContext` (X-Tenant-Id header, anonymous) is Development-only;
  production requires `JWT_SIGNING_KEY` and resolves the tenant from the `tenant_id` JWT claim.
  Replace with a real login flow. Production refuses to boot without auth config.

## Config (12-factor — env vars only)

| Variable | Purpose |
|---|---|
| `ConnectionStrings__Default` | Postgres connection string (required outside Development) |
| `JWT_SIGNING_KEY` | Bearer token signing key (required outside Development) |
| `Database__MigrateOnStartup` | `true` ⇒ apply migrations on boot (docker compose) |

## Schema changes

Any table change ships in ONE PR containing all three:
1. Entity + `AppDbContext` mapping + EF migration here,
2. the SQLAlchemy model in `dataplane/src/pricepilot/db/tables.py`,
3. `shared/contracts/table-ownership.md` (and `jobs.md` / `recommendation-factors.md` if affected).
