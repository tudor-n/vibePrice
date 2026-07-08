using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PricePilot.Domain;
using PricePilot.Infrastructure;
using Xunit;

namespace PricePilot.UnitTests;

/// <summary>
/// GET /api/v1/properties/{id}/competitors (discovered competitors only, ratings exposed) and
/// DELETE /api/v1/competitors/{id} (untrack via soft-delete), per shared/contracts/openapi.yaml.
/// </summary>
public sealed class CompetitorDiscoveryTests : IDisposable
{
    private const string SigningKey = "unit-test-signing-key-0123456789abcdef-0123456789abcdef";

    private readonly Guid _tenantA = Guid.NewGuid();
    private readonly Guid _tenantB = Guid.NewGuid();
    private readonly SqliteConnection _connection;
    private readonly WebApplicationFactory<Program> _factory;

    public CompetitorDiscoveryTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("JWT_SIGNING_KEY", SigningKey);
            builder.UseSetting("Demo:SeedOnStartup", "false");
            builder.UseSetting("Database:MigrateOnStartup", "false");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<AppDbContext>>();
                services.RemoveAll<IDbContextOptionsConfiguration<AppDbContext>>();
                services.AddDbContext<AppDbContext>(options => options
                    .UseSqlite(_connection)
                    .UseSnakeCaseNamingConvention());
            });
        });

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Database.EnsureCreated();

        db.Tenants.AddRange(
            new Tenant
            {
                Id = _tenantA, Name = "Tenant A", SubscriptionPlan = "demo",
                SubscriptionStatus = "active", CreatedAt = DateTimeOffset.UtcNow,
            },
            new Tenant
            {
                Id = _tenantB, Name = "Tenant B", SubscriptionPlan = "demo",
                SubscriptionStatus = "active", CreatedAt = DateTimeOffset.UtcNow,
            });
        db.SaveChanges();
    }

    private HttpClient CreateTenantClient(Guid tenantId)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Tenant-Id", tenantId.ToString());
        return client;
    }

    private (Guid PropertyId, Guid CompetitorId) SeedDiscoveredCompetitor(
        Guid tenantId, decimal? rating = null, int? ratingCount = null)
    {
        var propertyId = Guid.NewGuid();
        var competitorId = Guid.NewGuid();

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Properties.Add(new Property
        {
            Id = propertyId,
            TenantId = tenantId,
            Name = "Hotel Continental Forum",
            City = "sibiu",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        db.Competitors.Add(new Competitor
        {
            Id = competitorId,
            TenantId = tenantId,
            PropertyId = propertyId,
            Name = "Hotel Ramada Sibiu",
            Rating = rating,
            RatingCount = ratingCount,
            DiscoveredAt = DateTimeOffset.UtcNow,
            DiscoverySource = "google_places",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        db.SaveChanges();
        return (propertyId, competitorId);
    }

    [Fact]
    public async Task Untrack_sets_excluded_and_hides_from_list()
    {
        var client = CreateTenantClient(_tenantA);
        var (propertyId, competitorId) = SeedDiscoveredCompetitor(_tenantA);

        var del = await client.DeleteAsync($"/api/v1/competitors/{competitorId}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        var list = await client.GetFromJsonAsync<List<JsonElement>>(
            $"/api/v1/properties/{propertyId}/competitors");
        Assert.Empty(list!);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var row = await db.Competitors.IgnoreQueryFilters().SingleAsync(c => c.Id == competitorId);
        Assert.NotNull(row.ExcludedAt); // tombstone row persists
    }

    [Fact]
    public async Task Untrack_foreign_competitor_is_404()
    {
        var (_, competitorId) = SeedDiscoveredCompetitor(_tenantA);
        var client = CreateTenantClient(_tenantB);

        var del = await client.DeleteAsync($"/api/v1/competitors/{competitorId}");
        Assert.Equal(HttpStatusCode.NotFound, del.StatusCode);
    }

    [Fact]
    public async Task Competitor_list_exposes_rating()
    {
        var client = CreateTenantClient(_tenantA);
        var (propertyId, _) = SeedDiscoveredCompetitor(_tenantA, rating: 4.2m, ratingCount: 512);

        var list = await client.GetFromJsonAsync<List<JsonElement>>(
            $"/api/v1/properties/{propertyId}/competitors");
        Assert.Equal(4.2, list!.Single().GetProperty("rating").GetDouble(), 3);
    }

    public void Dispose()
    {
        _factory.Dispose();
        _connection.Dispose();
    }
}
