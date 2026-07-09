using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using PricePilot.Application;
using PricePilot.Domain;
using PricePilot.Infrastructure;
using Xunit;

namespace PricePilot.UnitTests;

/// <summary>
/// Google Places foundation schema: place columns on Property/Competitor round-trip,
/// and points_of_interest is reachable without a resolved tenant (city-scoped, not
/// tenant-owned — see shared/contracts/table-ownership.md).
/// </summary>
public sealed class PlaceSchemaTests : IDisposable
{
    private sealed record FixedTenantContext(Guid? TenantId) : ITenantContext;

    private readonly SqliteConnection _connection;
    private readonly Guid _tenantA = Guid.NewGuid();

    public PlaceSchemaTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        using var db = CreateContext(_tenantA);
        db.Database.EnsureCreated();

        db.Tenants.Add(new Tenant { Id = _tenantA, Name = "Tenant A", SubscriptionPlan = "starter", SubscriptionStatus = "active" });
        db.SaveChanges();
    }

    private AppDbContext CreateContext(Guid? tenantId)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(_connection)
            .UseSnakeCaseNamingConvention()
            .Options;
        return new AppDbContext(options, new FixedTenantContext(tenantId));
    }

    [Fact]
    public async Task Property_persists_google_place_fields()
    {
        using var ctx = CreateContext(_tenantA);
        var p = new Property
        {
            Id = Guid.NewGuid(),
            TenantId = _tenantA,
            Name = "Hotel X",
            City = "sibiu",
            PlaceId = "ChIJabc",
            Latitude = 45.798300m,
            Longitude = 24.125600m,
            Rating = 4.4m,
            RatingCount = 1280,
            PlaceResolvedAt = DateTimeOffset.UtcNow,
            PlaceCandidates = "[]",
            CreatedAt = DateTimeOffset.UtcNow,
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
        using var ctx = CreateContext(Guid.Empty); // no tenant resolved
        ctx.PointsOfInterest.Add(new PointOfInterest
        {
            Id = Guid.NewGuid(),
            City = "sibiu",
            Name = "Piata Mare",
            Latitude = 45.797300m,
            Longitude = 24.152100m,
            Weight = 100,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await ctx.SaveChangesAsync();
        Assert.Equal(1, await ctx.PointsOfInterest.CountAsync()); // visible without a tenant
    }

    public void Dispose() => _connection.Dispose();
}
