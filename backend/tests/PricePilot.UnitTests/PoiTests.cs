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
/// PoiSeeder.SeedAsync is idempotent (deterministic id per city+name; a second run does not
/// duplicate rows) and GET /api/v1/points-of-interest?city= serves points of interest as
/// public reference data — NOT tenant-scoped (shared/contracts/openapi.yaml).
/// </summary>
public sealed class PoiTests : IDisposable
{
    private const string SigningKey = "unit-test-signing-key-0123456789abcdef-0123456789abcdef";

    private readonly Guid _tenantId = Guid.NewGuid();
    private readonly SqliteConnection _connection;
    private readonly WebApplicationFactory<Program> _factory;

    public PoiTests()
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
    public async Task Seeder_is_idempotent_and_endpoint_returns_city_pois()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await PoiSeeder.SeedAsync(db, default);
            await PoiSeeder.SeedAsync(db, default); // second run must not duplicate
            Assert.Equal(5, await db.PointsOfInterest.CountAsync(p => p.City == "sibiu"));
        }

        var client = CreateTenantClient();
        var pois = await client.GetFromJsonAsync<List<JsonElement>>("/api/v1/points-of-interest?city=sibiu");
        Assert.Contains(pois!, p => p.GetProperty("name").GetString() == "Piața Mare");
    }

    [Fact]
    public async Task Endpoint_returns_empty_list_for_unknown_city()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await PoiSeeder.SeedAsync(db, default);
        }

        var client = CreateTenantClient();
        var pois = await client.GetFromJsonAsync<List<JsonElement>>("/api/v1/points-of-interest?city=timisoara");
        Assert.Empty(pois!);
    }

    [Fact]
    public async Task Endpoint_requires_city_query_param()
    {
        var client = CreateTenantClient();
        var resp = await client.GetAsync("/api/v1/points-of-interest");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    public void Dispose()
    {
        _factory.Dispose();
        _connection.Dispose();
    }
}
