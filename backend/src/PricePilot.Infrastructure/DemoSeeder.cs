using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using PricePilot.Domain;

namespace PricePilot.Infrastructure;

/// <summary>
/// Seeds the backend-owned demo rows fixed in shared/contracts/demo-seed.md: one tenant,
/// one user, one property, two room types, three competitors — all with contract UUIDs.
/// Dev/demo only: Program.cs runs it solely when Demo__SeedOnStartup=true AND the
/// environment is Development, after migrations.
///
/// Idempotent by construction: each row is inserted only when its fixed primary key is
/// absent and never updated afterwards, so re-running (including against a partially
/// seeded database) converges on the same state.
///
/// NOTE on IgnoreQueryFilters: this is deliberate, legitimate SYSTEM code. The seeder
/// runs in a startup scope with no resolved tenant, where the tenant global query filter
/// matches nothing — existence checks would always report "missing" and re-runs would
/// crash on duplicate keys. It writes a fixed cross-tenant demo world and never serves
/// request-scoped data.
/// </summary>
public sealed class DemoSeeder(AppDbContext db, IPasswordHasher<User> passwordHasher, ILogger<DemoSeeder> logger)
{
    public const string DemoEmail = "demo@pricepilot.local";
    public const string DemoPassword = "Demo1234!";

    public static readonly Guid TenantId = Guid.Parse("11111111-1111-4111-8111-111111111111");
    public static readonly Guid UserId = Guid.Parse("22222222-2222-4222-8222-222222222222");
    public static readonly Guid PropertyId = Guid.Parse("33333333-3333-4333-8333-333333333333");
    public static readonly Guid RoomTypeDoubleId = Guid.Parse("44444444-4444-4444-8444-444444444444");
    public static readonly Guid RoomTypeApartmentId = Guid.Parse("55555555-5555-4555-8555-555555555555");
    public static readonly Guid CompetitorRamadaId = Guid.Parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    public static readonly Guid CompetitorImparatulId = Guid.Parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    public static readonly Guid CompetitorLuxemburgId = Guid.Parse("cccccccc-cccc-4ccc-8ccc-cccccccccccc");

    /// <summary>Fixed instant so repeated seeding is fully deterministic.</summary>
    private static readonly DateTimeOffset SeedCreatedAt = new(2026, 7, 1, 0, 0, 0, TimeSpan.Zero);

    public async Task SeedAsync(CancellationToken ct = default)
    {
        var inserted = 0;

        // Tenants carry no tenant query filter.
        if (!await db.Tenants.AnyAsync(t => t.Id == TenantId, ct))
        {
            db.Tenants.Add(new Tenant
            {
                Id = TenantId,
                Name = "Pensiunea Demo SRL",
                SubscriptionPlan = "demo",
                SubscriptionStatus = "active",
                CreatedAt = SeedCreatedAt,
            });
            inserted++;
        }

        // System code: see class-level note on IgnoreQueryFilters.
        if (!await db.Users.IgnoreQueryFilters().AnyAsync(u => u.Id == UserId, ct))
        {
            var user = new User
            {
                Id = UserId,
                TenantId = TenantId,
                // users.email invariant: always store the normalized form (see User.NormalizeEmail).
                Email = User.NormalizeEmail(DemoEmail),
                DisplayName = "Demo Owner",
                PasswordHash = "",
                Role = "owner",
                CreatedAt = SeedCreatedAt,
            };
            user.PasswordHash = passwordHasher.HashPassword(user, DemoPassword);
            db.Users.Add(user);
            inserted++;
        }

        // System code: see class-level note on IgnoreQueryFilters.
        if (!await db.Properties.IgnoreQueryFilters().AnyAsync(p => p.Id == PropertyId, ct))
        {
            db.Properties.Add(new Property
            {
                Id = PropertyId,
                TenantId = TenantId,
                Name = "Pensiunea Piața Mică",
                City = "sibiu",
                Address = null,
                CreatedAt = SeedCreatedAt,
            });
            inserted++;
        }

        inserted += await AddRoomTypeIfMissingAsync(RoomTypeDoubleId, "Cameră dublă", capacity: 2, price: 350.00m, ct);
        inserted += await AddRoomTypeIfMissingAsync(RoomTypeApartmentId, "Apartament", capacity: 4, price: 520.00m, ct);

        inserted += await AddCompetitorIfMissingAsync(
            CompetitorRamadaId, "Hotel Ramada Sibiu", "https://www.booking.com/hotel/ro/ramada-sibiu.html", ct);
        inserted += await AddCompetitorIfMissingAsync(
            CompetitorImparatulId, "Hotel Împăratul Romanilor", "https://www.booking.com/hotel/ro/imparatul-romanilor.html", ct);
        inserted += await AddCompetitorIfMissingAsync(
            CompetitorLuxemburgId, "Casa Luxemburg", "https://www.booking.com/hotel/ro/casa-luxemburg.html", ct);

        await db.SaveChangesAsync(ct);
        logger.LogInformation("Demo seed complete: {Inserted} row(s) inserted, the rest already existed.", inserted);
    }

    private async Task<int> AddRoomTypeIfMissingAsync(Guid id, string name, int capacity, decimal price, CancellationToken ct)
    {
        // System code: see class-level note on IgnoreQueryFilters.
        if (await db.RoomTypes.IgnoreQueryFilters().AnyAsync(r => r.Id == id, ct))
        {
            return 0;
        }

        db.RoomTypes.Add(new RoomType
        {
            Id = id,
            TenantId = TenantId,
            PropertyId = PropertyId,
            Name = name,
            Capacity = capacity,
            BasePrice = price,
            CurrentPrice = price,
            Currency = "RON",
        });
        return 1;
    }

    private async Task<int> AddCompetitorIfMissingAsync(Guid id, string name, string sourceUrl, CancellationToken ct)
    {
        // System code: see class-level note on IgnoreQueryFilters.
        if (await db.Competitors.IgnoreQueryFilters().AnyAsync(c => c.Id == id, ct))
        {
            return 0;
        }

        db.Competitors.Add(new Competitor
        {
            Id = id,
            TenantId = TenantId,
            PropertyId = PropertyId,
            Name = name,
            SourceUrl = sourceUrl,
            CreatedAt = SeedCreatedAt,
        });
        return 1;
    }
}
