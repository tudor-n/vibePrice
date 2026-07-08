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
/// PATCH /api/v1/properties/{id}/place (pick a stored candidate) and
/// POST /api/v1/properties/{id}/resolve-place (re-enqueue resolve_place),
/// per shared/contracts/openapi.yaml and shared/contracts/jobs.md.
/// </summary>
public sealed class PropertyCorrectionTests : IDisposable
{
    private const string SigningKey = "unit-test-signing-key-0123456789abcdef-0123456789abcdef";

    private readonly Guid _tenantA = Guid.NewGuid();
    private readonly Guid _tenantB = Guid.NewGuid();
    private readonly SqliteConnection _connection;
    private readonly WebApplicationFactory<Program> _factory;

    public PropertyCorrectionTests()
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

    // place_candidates stored as snake_case JSON (shared/contracts/place-candidates.md).
    private const string CandidatesJson =
        """
        [
          { "place_id": "ChIJ_wrong", "name": "Wrong Hotel", "formatted_address": "Somewhere Else",
            "latitude": 45.0000, "longitude": 24.0000, "rating": 3.9, "rating_count": 50 },
          { "place_id": "ChIJ_right", "name": "Hotel Continental Forum", "formatted_address": "Piata Unirii 10, Sibiu",
            "latitude": 45.7960, "longitude": 24.1520, "rating": 4.6, "rating_count": 900 }
        ]
        """;

    private Guid SeedPropertyWithCandidates(Guid tenantId)
    {
        var propertyId = Guid.NewGuid();

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Properties.Add(new Property
        {
            Id = propertyId,
            TenantId = tenantId,
            Name = "Hotel Continental Forum",
            City = "sibiu",
            PlaceCandidates = CandidatesJson,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        db.SaveChanges();
        return propertyId;
    }

    [Fact]
    public async Task Pick_place_copies_candidate_fields_and_sets_resolved()
    {
        var client = CreateTenantClient(_tenantA);
        var propertyId = SeedPropertyWithCandidates(_tenantA);

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
        var client = CreateTenantClient(_tenantA);
        var propertyId = SeedPropertyWithCandidates(_tenantA);

        var resp = await client.PatchAsJsonAsync($"/api/v1/properties/{propertyId}/place",
            new { placeId = "ChIJ_not_a_candidate" });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Pick_foreign_property_is_404()
    {
        var propertyId = SeedPropertyWithCandidates(_tenantA);
        var client = CreateTenantClient(_tenantB);

        var resp = await client.PatchAsJsonAsync($"/api/v1/properties/{propertyId}/place",
            new { placeId = "ChIJ_right" });
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Resolve_place_endpoint_enqueues_job()
    {
        var client = CreateTenantClient(_tenantA);
        var propertyId = SeedPropertyWithCandidates(_tenantA);

        var resp = await client.PostAsJsonAsync($"/api/v1/properties/{propertyId}/resolve-place",
            new { query = "Hotel Continental Forum Sibiu" });
        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await db.Jobs.CountAsync(j => j.Type == "resolve_place"));
    }

    [Fact]
    public async Task Resolve_place_foreign_property_is_404()
    {
        var propertyId = SeedPropertyWithCandidates(_tenantA);
        var client = CreateTenantClient(_tenantB);

        var resp = await client.PostAsJsonAsync($"/api/v1/properties/{propertyId}/resolve-place",
            new { });
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    public void Dispose()
    {
        _factory.Dispose();
        _connection.Dispose();
    }
}
