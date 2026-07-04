using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using PricePilot.Application;
using PricePilot.Domain;
using PricePilot.Infrastructure;
using Xunit;

namespace PricePilot.UnitTests;

/// <summary>
/// Verifies the ITenantOwned global query filter on the real AppDbContext model,
/// using SQLite in-memory (jsonb columns degrade to TEXT affinity there, which is fine
/// for filter semantics; PostgreSQL specifics are covered by integration tests).
/// </summary>
public sealed class TenantQueryFilterTests : IDisposable
{
    private sealed record FixedTenantContext(Guid? TenantId) : ITenantContext;

    private readonly SqliteConnection _connection;
    private readonly Guid _tenantA = Guid.NewGuid();
    private readonly Guid _tenantB = Guid.NewGuid();

    public TenantQueryFilterTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        using var db = CreateContext(_tenantA);
        db.Database.EnsureCreated();

        db.Tenants.AddRange(
            new Tenant { Id = _tenantA, Name = "Tenant A", SubscriptionPlan = "starter", SubscriptionStatus = "active" },
            new Tenant { Id = _tenantB, Name = "Tenant B", SubscriptionPlan = "starter", SubscriptionStatus = "active" });

        // Inserts are not affected by query filters, so one context can seed both tenants.
        db.Properties.AddRange(
            new Property { Id = Guid.NewGuid(), TenantId = _tenantA, Name = "Casa Sibiu", City = "sibiu" },
            new Property { Id = Guid.NewGuid(), TenantId = _tenantA, Name = "Vila Piata Mica", City = "sibiu" },
            new Property { Id = Guid.NewGuid(), TenantId = _tenantB, Name = "Hotel B", City = "sibiu" });
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
    public void Queries_only_see_the_current_tenant()
    {
        using var dbA = CreateContext(_tenantA);
        var namesA = dbA.Properties.Select(p => p.Name).OrderBy(n => n).ToList();
        Assert.Equal(["Casa Sibiu", "Vila Piata Mica"], namesA);

        using var dbB = CreateContext(_tenantB);
        var namesB = dbB.Properties.Select(p => p.Name).ToList();
        Assert.Equal(["Hotel B"], namesB);
    }

    [Fact]
    public void No_resolved_tenant_means_no_rows()
    {
        using var db = CreateContext(null);
        Assert.Empty(db.Properties.ToList());
    }

    [Fact]
    public void Non_tenant_owned_entities_are_not_filtered()
    {
        using (var seed = CreateContext(_tenantA))
        {
            seed.Events.Add(new Event
            {
                Id = Guid.NewGuid(),
                City = "sibiu",
                Name = "FITS",
                StartDate = new DateOnly(2026, 6, 12),
                EndDate = new DateOnly(2026, 6, 21),
                ImpactScore = 95,
                Source = "test",
            });
            seed.SaveChanges();
        }

        // Events are city-scoped shared data: visible regardless of tenant.
        using var db = CreateContext(null);
        Assert.Single(db.Events.ToList());
    }

    public void Dispose() => _connection.Dispose();
}
