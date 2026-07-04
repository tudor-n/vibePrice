using Microsoft.AspNetCore.Identity;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using PricePilot.Application;
using PricePilot.Domain;
using PricePilot.Infrastructure;
using Xunit;

namespace PricePilot.UnitTests;

/// <summary>
/// DemoSeeder must produce exactly the rows fixed in shared/contracts/demo-seed.md,
/// be idempotent (running twice yields identical state), and cope with partially
/// seeded databases. SQLite in-memory against the real AppDbContext model.
/// </summary>
public sealed class DemoSeederTests : IDisposable
{
    private sealed record FixedTenantContext(Guid? TenantId) : ITenantContext;

    private static readonly Guid TenantId = Guid.Parse("11111111-1111-4111-8111-111111111111");
    private static readonly Guid UserId = Guid.Parse("22222222-2222-4222-8222-222222222222");
    private static readonly Guid PropertyId = Guid.Parse("33333333-3333-4333-8333-333333333333");
    private static readonly Guid RoomTypeDoubleId = Guid.Parse("44444444-4444-4444-8444-444444444444");
    private static readonly Guid RoomTypeApartmentId = Guid.Parse("55555555-5555-4555-8555-555555555555");
    private static readonly Guid CompetitorRamadaId = Guid.Parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    private static readonly Guid CompetitorImparatulId = Guid.Parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    private static readonly Guid CompetitorLuxemburgId = Guid.Parse("cccccccc-cccc-4ccc-8ccc-cccccccccccc");

    private readonly SqliteConnection _connection;

    public DemoSeederTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();
        using var db = CreateContext();
        db.Database.EnsureCreated();
    }

    // The seeder runs in a startup scope with no resolved tenant — exactly like Program.cs.
    private AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(_connection)
            .UseSnakeCaseNamingConvention()
            .Options;
        return new AppDbContext(options, new FixedTenantContext(null));
    }

    private async Task RunSeederAsync()
    {
        await using var db = CreateContext();
        var seeder = new DemoSeeder(db, new PasswordHasher<User>(), NullLogger<DemoSeeder>.Instance);
        await seeder.SeedAsync();
    }

    private void AssertExactContractState()
    {
        using var db = CreateContext();

        Assert.Equal(1, db.Tenants.Count());
        var tenant = db.Tenants.Single();
        Assert.Equal(TenantId, tenant.Id);
        Assert.Equal("Pensiunea Demo SRL", tenant.Name);
        Assert.Equal("demo", tenant.SubscriptionPlan);

        // Tenant-owned tables are checked via IgnoreQueryFilters: this test context has no
        // resolved tenant on purpose (assertion-only code, mirrors admin/system usage).
        Assert.Equal(1, db.Users.IgnoreQueryFilters().Count());
        var user = db.Users.IgnoreQueryFilters().Single();
        Assert.Equal(UserId, user.Id);
        Assert.Equal(TenantId, user.TenantId);
        Assert.Equal("demo@pricepilot.local", user.Email);
        Assert.Equal("owner", user.Role);

        Assert.Equal(1, db.Properties.IgnoreQueryFilters().Count());
        var property = db.Properties.IgnoreQueryFilters().Single();
        Assert.Equal(PropertyId, property.Id);
        Assert.Equal("Pensiunea Piața Mică", property.Name);
        Assert.Equal("sibiu", property.City);

        Assert.Equal(2, db.RoomTypes.IgnoreQueryFilters().Count());
        var doubleRoom = db.RoomTypes.IgnoreQueryFilters().Single(r => r.Id == RoomTypeDoubleId);
        Assert.Equal("Cameră dublă", doubleRoom.Name);
        Assert.Equal(2, doubleRoom.Capacity);
        Assert.Equal(350.00m, doubleRoom.BasePrice);
        Assert.Equal(350.00m, doubleRoom.CurrentPrice);
        Assert.Equal("RON", doubleRoom.Currency);
        var apartment = db.RoomTypes.IgnoreQueryFilters().Single(r => r.Id == RoomTypeApartmentId);
        Assert.Equal("Apartament", apartment.Name);
        Assert.Equal(4, apartment.Capacity);
        Assert.Equal(520.00m, apartment.BasePrice);
        Assert.Equal(520.00m, apartment.CurrentPrice);
        Assert.Equal("RON", apartment.Currency);

        Assert.Equal(3, db.Competitors.IgnoreQueryFilters().Count());
        var competitors = db.Competitors.IgnoreQueryFilters().ToDictionary(c => c.Id, c => c.Name);
        Assert.Equal("Hotel Ramada Sibiu", competitors[CompetitorRamadaId]);
        Assert.Equal("Hotel Împăratul Romanilor", competitors[CompetitorImparatulId]);
        Assert.Equal("Casa Luxemburg", competitors[CompetitorLuxemburgId]);
    }

    [Fact]
    public async Task Seeding_twice_yields_exactly_the_contract_rows()
    {
        await RunSeederAsync();
        await RunSeederAsync();
        AssertExactContractState();
    }

    [Fact]
    public async Task Seeding_a_partially_seeded_database_completes_the_set()
    {
        // Simulate a partial previous run: tenant + property + one room type already exist
        // (a valid partial state must respect the FK chain tenant -> property -> room type).
        using (var db = CreateContext())
        {
            db.Tenants.Add(new Tenant
            {
                Id = TenantId,
                Name = "Pensiunea Demo SRL",
                SubscriptionPlan = "demo",
                SubscriptionStatus = "active",
            });
            db.Properties.Add(new Property
            {
                Id = PropertyId,
                TenantId = TenantId,
                Name = "Pensiunea Piața Mică",
                City = "sibiu",
            });
            db.RoomTypes.Add(new RoomType
            {
                Id = RoomTypeDoubleId,
                TenantId = TenantId,
                PropertyId = PropertyId,
                Name = "Cameră dublă",
                Capacity = 2,
                BasePrice = 350.00m,
                CurrentPrice = 350.00m,
                Currency = "RON",
            });
            db.SaveChanges();
        }

        await RunSeederAsync();
        AssertExactContractState();
    }

    [Fact]
    public async Task Seeded_user_password_verifies_against_the_demo_password()
    {
        await RunSeederAsync();

        using var db = CreateContext();
        // System-code check, see comment in AssertExactContractState.
        var user = db.Users.IgnoreQueryFilters().Single(u => u.Id == UserId);
        var result = new PasswordHasher<User>().VerifyHashedPassword(user, user.PasswordHash, "Demo1234!");
        Assert.NotEqual(PasswordVerificationResult.Failed, result);
    }

    public void Dispose() => _connection.Dispose();
}
