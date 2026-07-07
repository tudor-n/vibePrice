using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using PricePilot.Api.Auth;
using PricePilot.Application;
using PricePilot.Domain;
using PricePilot.Infrastructure;
using Xunit;

namespace PricePilot.UnitTests;

/// <summary>
/// End-to-end tests for POST /api/v1/auth/login (shared/contracts/openapi.yaml) via
/// WebApplicationFactory with SQLite in-memory. Development environment: verifies the
/// dev X-Tenant-Id path keeps working alongside real Bearer tokens.
/// </summary>
public sealed class LoginEndpointTests : IDisposable
{
    private const string SigningKey = "unit-test-signing-key-0123456789abcdef-0123456789abcdef";
    private const string DemoEmail = "demo@pricepilot.local";
    private const string DemoPassword = "Demo1234!";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly Guid _tenantId = Guid.NewGuid();
    private readonly Guid _userId = Guid.NewGuid();
    private readonly SqliteConnection _connection;
    private readonly WebApplicationFactory<Program> _factory;

    public LoginEndpointTests()
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
                // Swap Npgsql for SQLite in-memory on the shared kept-open connection.
                // EF9 registers per-context configuration entries that AddDbContext merges,
                // so both must be removed or two providers end up registered.
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
            Name = "Pensiunea Demo SRL",
            SubscriptionPlan = "demo",
            SubscriptionStatus = "active",
        });
        var user = new User
        {
            Id = _userId,
            TenantId = _tenantId,
            Email = DemoEmail,
            DisplayName = "Demo Owner",
            PasswordHash = "",
            Role = "owner",
        };
        user.PasswordHash = new PasswordHasher<User>().HashPassword(user, DemoPassword);
        db.Users.Add(user);
        db.Properties.Add(new Property
        {
            Id = Guid.NewGuid(),
            TenantId = _tenantId,
            Name = "Pensiunea Piața Mică",
            City = "sibiu",
        });
        db.SaveChanges();
    }

    private static Task<HttpResponseMessage> LoginAsync(HttpClient client, string email, string password) =>
        client.PostAsJsonAsync("/api/v1/auth/login", new { email, password });

    [Fact]
    public async Task Valid_credentials_return_token_user_info_and_12h_expiry()
    {
        using var client = _factory.CreateClient();
        var response = await LoginAsync(client, DemoEmail, DemoPassword);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<LoginResponseDto>(Json);
        Assert.NotNull(body);

        Assert.Equal(_userId, body.User.Id);
        Assert.Equal(DemoEmail, body.User.Email);
        Assert.Equal("Demo Owner", body.User.DisplayName);
        Assert.Equal("owner", body.User.Role);
        Assert.Equal(_tenantId, body.User.TenantId);

        var expiresIn = body.ExpiresAt - DateTimeOffset.UtcNow;
        Assert.InRange(expiresIn, TimeSpan.FromHours(11.5), TimeSpan.FromHours(12.5));

        // The token must validate with the same key Program.cs configures and carry
        // the claims JwtClaimTenantContext and the web client rely on.
        var validation = await new JsonWebTokenHandler().ValidateTokenAsync(body.Token, new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(SigningKey)),
            ValidateIssuer = false,
            ValidateAudience = false,
        });
        Assert.True(validation.IsValid);
        Assert.Equal(_userId.ToString(), validation.Claims[JwtRegisteredClaimNames.Sub]?.ToString());
        Assert.Equal(_tenantId.ToString(), validation.Claims[AuthConstants.TenantClaim]?.ToString());
        Assert.Equal(DemoEmail, validation.Claims[JwtRegisteredClaimNames.Email]?.ToString());
        Assert.Equal("owner", validation.Claims["role"]?.ToString());
    }

    [Fact]
    public async Task Mixed_case_and_padded_email_logs_in()
    {
        using var client = _factory.CreateClient();

        // users.email is stored normalized (trimmed + lowercased); login input is
        // normalized the same way, so casing/whitespace differences must not matter.
        var response = await LoginAsync(client, "  Demo@PricePilot.LOCAL ", DemoPassword);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<LoginResponseDto>(Json);
        Assert.NotNull(body);
        Assert.Equal(DemoEmail, body.User.Email);
    }

    [Fact]
    public async Task Wrong_password_and_unknown_email_return_identical_401s()
    {
        using var client = _factory.CreateClient();

        var wrongPassword = await LoginAsync(client, DemoEmail, "not-the-password");
        var unknownEmail = await LoginAsync(client, "nobody@pricepilot.local", DemoPassword);

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownEmail.StatusCode);

        // Uniform response: no user-enumeration signal in the body.
        Assert.Equal(
            await wrongPassword.Content.ReadAsStringAsync(),
            await unknownEmail.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Bearer_token_resolves_the_tenant_and_dev_header_still_works()
    {
        using var client = _factory.CreateClient();
        var login = await LoginAsync(client, DemoEmail, DemoPassword);
        var body = await login.Content.ReadFromJsonAsync<LoginResponseDto>(Json);
        Assert.NotNull(body);

        // Bearer token path (production behavior, must also work in Development).
        using var bearerRequest = new HttpRequestMessage(HttpMethod.Get, "/api/v1/properties");
        bearerRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", body.Token);
        var bearerResponse = await client.SendAsync(bearerRequest);
        Assert.Equal(HttpStatusCode.OK, bearerResponse.StatusCode);
        var viaBearer = await bearerResponse.Content.ReadFromJsonAsync<List<PropertyDto>>(Json);
        Assert.NotNull(viaBearer);
        Assert.Single(viaBearer);

        // Dev X-Tenant-Id path must keep working (web dev + tooling rely on it).
        using var headerRequest = new HttpRequestMessage(HttpMethod.Get, "/api/v1/properties");
        headerRequest.Headers.Add("X-Tenant-Id", _tenantId.ToString());
        var headerResponse = await client.SendAsync(headerRequest);
        Assert.Equal(HttpStatusCode.OK, headerResponse.StatusCode);
        var viaHeader = await headerResponse.Content.ReadFromJsonAsync<List<PropertyDto>>(Json);
        Assert.NotNull(viaHeader);
        Assert.Single(viaHeader);
    }

    [Fact]
    public async Task Login_is_rate_limited_per_ip()
    {
        using var client = _factory.CreateClient();

        // Fixed window of 10/min per IP; the test server counts as one client IP.
        for (var i = 0; i < 10; i++)
        {
            var response = await LoginAsync(client, "nobody@pricepilot.local", "wrong");
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        var throttled = await LoginAsync(client, "nobody@pricepilot.local", "wrong");
        Assert.Equal(HttpStatusCode.TooManyRequests, throttled.StatusCode);
    }

    [Fact]
    public async Task X_forwarded_for_cannot_bypass_the_rate_limit_unless_explicitly_enabled()
    {
        // ForwardedHeaders__Enabled is NOT set: a spoofed X-Forwarded-For must not create
        // a fresh rate-limit partition per request (that would void brute-force protection).
        using var client = _factory.CreateClient();

        for (var i = 0; i < 10; i++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/login")
            {
                Content = JsonContent.Create(new { email = "nobody@pricepilot.local", password = "wrong" }),
            };
            request.Headers.Add("X-Forwarded-For", $"203.0.113.{i}");
            var response = await client.SendAsync(request);
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        using var throttledRequest = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/login")
        {
            Content = JsonContent.Create(new { email = "nobody@pricepilot.local", password = "wrong" }),
        };
        throttledRequest.Headers.Add("X-Forwarded-For", "203.0.113.99");
        var throttled = await client.SendAsync(throttledRequest);
        Assert.Equal(HttpStatusCode.TooManyRequests, throttled.StatusCode);
    }

    public void Dispose()
    {
        _factory.Dispose();
        _connection.Dispose();
    }
}
