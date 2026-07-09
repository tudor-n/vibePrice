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
/// POST /api/v1/properties/{propertyId}/room-types (shared/contracts/openapi.yaml):
/// tenant-scoped room-type creation with server-side defaults (currentPrice ← basePrice,
/// currency ← "RON") and endpoint-layer validation.
/// </summary>
public sealed class RoomTypeCreateTests : IDisposable
{
    private const string SigningKey = "unit-test-signing-key-0123456789abcdef-0123456789abcdef";

    private readonly Guid _tenantA = Guid.NewGuid();
    private readonly Guid _tenantB = Guid.NewGuid();
    private readonly SqliteConnection _connection;
    private readonly WebApplicationFactory<Program> _factory;

    public RoomTypeCreateTests()
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

    private Guid SeedProperty(Guid tenantId)
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
            CreatedAt = DateTimeOffset.UtcNow,
        });
        db.SaveChanges();
        return propertyId;
    }

    [Fact]
    public async Task Create_room_type_with_defaults_returns_201_and_appears_on_property()
    {
        var client = CreateTenantClient(_tenantA);
        var propertyId = SeedProperty(_tenantA);

        var resp = await client.PostAsJsonAsync($"/api/v1/properties/{propertyId}/room-types",
            new { name = "Double room", capacity = 2, basePrice = 350.00m });
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(350.00, body.GetProperty("currentPrice").GetDouble(), 3); // defaults to basePrice
        Assert.Equal("RON", body.GetProperty("currency").GetString());          // default currency

        var props = await client.GetFromJsonAsync<List<JsonElement>>("/api/v1/properties");
        var rooms = props!.Single(p => p.GetProperty("id").GetString() == propertyId.ToString())
            .GetProperty("roomTypes");
        Assert.Equal(1, rooms.GetArrayLength());
    }

    [Theory]
    [InlineData(0, 350.0, "RON")]        // capacity < 1
    [InlineData(2, 0.0, "RON")]          // price <= 0
    [InlineData(2, 350.005, "RON")]      // > 2 decimals
    [InlineData(2, 350.0, "RONI")]       // bad currency
    public async Task Create_room_type_validation_returns_400(int capacity, double basePrice, string currency)
    {
        var client = CreateTenantClient(_tenantA);
        var propertyId = SeedProperty(_tenantA);
        var resp = await client.PostAsJsonAsync($"/api/v1/properties/{propertyId}/room-types",
            new { name = "Double room", capacity, basePrice = (decimal)basePrice, currency });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Create_room_type_on_foreign_property_is_404()
    {
        var propertyId = SeedProperty(_tenantA);
        var client = CreateTenantClient(_tenantB);
        var resp = await client.PostAsJsonAsync($"/api/v1/properties/{propertyId}/room-types",
            new { name = "Double room", capacity = 2, basePrice = 350.00m });
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    public void Dispose()
    {
        _factory.Dispose();
        _connection.Dispose();
    }
}
