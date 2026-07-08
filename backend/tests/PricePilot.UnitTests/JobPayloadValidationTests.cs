using System.Net;
using System.Net.Http.Json;
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
/// POST /api/v1/jobs payload validation: a property_id in the payload must resolve
/// through the tenant-filtered context — job payloads must never become a
/// cross-tenant trigger channel (root CLAUDE.md tenant-isolation hard rule).
/// </summary>
public sealed class JobPayloadValidationTests : IDisposable
{
    private const string SigningKey = "unit-test-signing-key-0123456789abcdef-0123456789abcdef";

    private readonly Guid _tenantId = Guid.NewGuid();
    private readonly Guid _otherTenantId = Guid.NewGuid();
    private readonly Guid _ownPropertyId = Guid.NewGuid();
    private readonly Guid _foreignPropertyId = Guid.NewGuid();
    private readonly SqliteConnection _connection;
    private readonly WebApplicationFactory<Program> _factory;

    public JobPayloadValidationTests()
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
                Id = _tenantId,
                Name = "Own Tenant",
                SubscriptionPlan = "demo",
                SubscriptionStatus = "active",
                CreatedAt = DateTimeOffset.UtcNow,
            },
            new Tenant
            {
                Id = _otherTenantId,
                Name = "Other Tenant",
                SubscriptionPlan = "demo",
                SubscriptionStatus = "active",
                CreatedAt = DateTimeOffset.UtcNow,
            });
        db.Properties.AddRange(
            new Property
            {
                Id = _ownPropertyId,
                TenantId = _tenantId,
                Name = "Pensiunea Proprie",
                City = "sibiu",
                CreatedAt = DateTimeOffset.UtcNow,
            },
            new Property
            {
                Id = _foreignPropertyId,
                TenantId = _otherTenantId,
                Name = "Pensiunea Străină",
                City = "sibiu",
                CreatedAt = DateTimeOffset.UtcNow,
            });
        db.SaveChanges();
    }

    private async Task<HttpResponseMessage> PostJobAsync(object body)
    {
        var client = _factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/jobs")
        {
            Content = JsonContent.Create(body),
        };
        request.Headers.Add("X-Tenant-Id", _tenantId.ToString());
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task Own_property_in_payload_is_accepted()
    {
        var response = await PostJobAsync(new
        {
            type = "scrape.competitor_rates",
            payload = new { city = "sibiu", property_id = _ownPropertyId },
        });
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
    }

    [Fact]
    public async Task Foreign_property_in_payload_is_not_found()
    {
        var response = await PostJobAsync(new
        {
            type = "engine.generate_recommendations",
            payload = new { property_id = _foreignPropertyId, horizon_days = 90 },
        });
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Unparseable_property_id_is_a_bad_request()
    {
        var response = await PostJobAsync(new
        {
            type = "scrape.competitor_rates",
            payload = new { property_id = "not-a-guid" },
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("property_id", body);
    }

    [Fact]
    public async Task Missing_payload_is_accepted()
    {
        var response = await PostJobAsync(new { type = "ingest.events" });
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
    }

    [Fact]
    public async Task Payload_without_property_id_is_accepted()
    {
        var response = await PostJobAsync(new
        {
            type = "ingest.events",
            payload = new { city = "sibiu" },
        });
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
    }

    [Fact]
    public async Task Explicit_null_property_id_is_accepted()
    {
        var response = await PostJobAsync(new
        {
            type = "engine.generate_recommendations",
            payload = new { property_id = (Guid?)null, horizon_days = 90 },
        });
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
    }

    public void Dispose()
    {
        _factory.Dispose();
        _connection.Dispose();
    }
}
