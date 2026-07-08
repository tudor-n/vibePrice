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
/// POST /api/v1/properties enqueues a resolve_place job carrying the new property's id,
/// and GET /api/v1/properties reports placeStatus == "unresolved" before any resolution
/// job has run (shared/contracts/jobs.md, shared/contracts/place-candidates.md).
/// </summary>
public sealed class PropertyResolveEnqueueTests : IDisposable
{
    private const string SigningKey = "unit-test-signing-key-0123456789abcdef-0123456789abcdef";

    private readonly Guid _tenantId = Guid.NewGuid();
    private readonly SqliteConnection _connection;
    private readonly WebApplicationFactory<Program> _factory;

    public PropertyResolveEnqueueTests()
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

        db.Tenants.Add(new Tenant
        {
            Id = _tenantId,
            Name = "Own Tenant",
            SubscriptionPlan = "demo",
            SubscriptionStatus = "active",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        db.SaveChanges();
    }

    private HttpClient CreateTenantClient()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Tenant-Id", _tenantId.ToString());
        return client;
    }

    [Fact]
    public async Task Post_property_creates_row_and_enqueues_resolve_place()
    {
        var client = CreateTenantClient();

        var resp = await client.PostAsJsonAsync("/api/v1/properties",
            new { name = "Hotel Continental Forum", city = "sibiu" });
        resp.EnsureSuccessStatusCode();

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var job = await db.Jobs.AsNoTracking().SingleAsync(j => j.Type == "resolve_place");
        Assert.Contains("property_id", job.Payload);
    }

    [Fact]
    public async Task Get_properties_reports_place_status_unresolved_before_resolution()
    {
        var client = CreateTenantClient();
        await client.PostAsJsonAsync("/api/v1/properties", new { name = "Hotel X", city = "sibiu" });

        var list = await client.GetFromJsonAsync<List<JsonElement>>("/api/v1/properties");
        Assert.Equal("unresolved", list!.Single().GetProperty("placeStatus").GetString());
    }

    [Fact]
    public async Task Get_properties_reports_resolved_and_deserializes_snake_case_candidates()
    {
        // place_candidates is stored as snake_case JSON (shared/contracts/place-candidates.md):
        // place_id, name, formatted_address, latitude, longitude, rating, rating_count.
        const string candidatesJson =
            """
            [{ "place_id": "ChIJabc", "name": "Hotel Continental Forum",
               "formatted_address": "Piata Unirii 10, Sibiu",
               "latitude": 45.798300, "longitude": 24.125600,
               "rating": 4.4, "rating_count": 1280 }]
            """;

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Properties.Add(new Property
            {
                Id = Guid.NewGuid(),
                TenantId = _tenantId,
                Name = "Hotel Continental Forum",
                City = "sibiu",
                PlaceId = "ChIJabc",
                Latitude = 45.798300m,
                Longitude = 24.125600m,
                Rating = 4.4m,
                RatingCount = 1280,
                PlaceResolvedAt = DateTimeOffset.UtcNow,
                PlaceCandidates = candidatesJson,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            db.SaveChanges();
        }

        var client = CreateTenantClient();
        var list = await client.GetFromJsonAsync<List<JsonElement>>("/api/v1/properties");
        var property = list!.Single();

        Assert.Equal("resolved", property.GetProperty("placeStatus").GetString());
        var candidate = property.GetProperty("placeCandidates").EnumerateArray().Single();
        Assert.Equal("ChIJabc", candidate.GetProperty("placeId").GetString());
        Assert.Equal("Piata Unirii 10, Sibiu", candidate.GetProperty("formattedAddress").GetString());
        Assert.Equal(1280, candidate.GetProperty("ratingCount").GetInt32());
    }

    [Fact]
    public async Task Get_properties_reports_failed_for_the_failed_sentinel()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Properties.Add(new Property
            {
                Id = Guid.NewGuid(),
                TenantId = _tenantId,
                Name = "Hotel Nowhere",
                City = "sibiu",
                PlaceCandidates = "__failed__",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            db.SaveChanges();
        }

        var client = CreateTenantClient();
        var list = await client.GetFromJsonAsync<List<JsonElement>>("/api/v1/properties");
        var property = list!.Single();

        Assert.Equal("failed", property.GetProperty("placeStatus").GetString());
        Assert.Empty(property.GetProperty("placeCandidates").EnumerateArray());
    }

    public void Dispose()
    {
        _factory.Dispose();
        _connection.Dispose();
    }
}
