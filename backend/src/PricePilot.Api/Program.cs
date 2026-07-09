using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using PricePilot.Api;
using PricePilot.Api.Auth;
using PricePilot.Api.Endpoints;
using PricePilot.Application;
using PricePilot.Connectors;
using PricePilot.Infrastructure;

var builder = WebApplication.CreateBuilder(args);
var isDevelopment = builder.Environment.IsDevelopment();

// ---------------------------------------------------------------------------
// 12-factor config: everything comes from environment variables.
//   ConnectionStrings__Default  -> Postgres connection string
//   JWT_SIGNING_KEY             -> symmetric key for bearer token validation
//   Database__MigrateOnStartup  -> apply EF migrations on boot (docker compose)
// ---------------------------------------------------------------------------
var connectionString = builder.Configuration.GetConnectionString("Default");
if (string.IsNullOrWhiteSpace(connectionString))
{
    if (!isDevelopment)
    {
        throw new InvalidOperationException(
            "ConnectionStrings__Default must be set outside Development (12-factor config).");
    }

    // Development fallback matching `docker compose up -d db`.
    connectionString = "Host=localhost;Port=5432;Database=pricepilot;Username=pricepilot;Password=pricepilot";
}

builder.Services.AddHttpContextAccessor();
builder.Services.AddInfrastructure(connectionString);
builder.Services.AddConnectors();

// ---------------------------------------------------------------------------
// Tenant resolution.
// TODO(auth): DEVELOPMENT-ONLY — DevHeaderTenantContext trusts the X-Tenant-Id header
// with no authentication. It is registered only when ASPNETCORE_ENVIRONMENT=Development.
// Production resolves the tenant from the tenant_id claim of a validated JWT.
// ---------------------------------------------------------------------------
if (isDevelopment)
{
    builder.Services.AddScoped<ITenantContext, DevHeaderTenantContext>();
}
else
{
    builder.Services.AddScoped<ITenantContext, JwtClaimTenantContext>();
}

// ---------------------------------------------------------------------------
// AuthN/AuthZ. Production refuses to boot without JWT_SIGNING_KEY.
// ---------------------------------------------------------------------------
var signingKey = builder.Configuration["JWT_SIGNING_KEY"];
if (string.IsNullOrWhiteSpace(signingKey))
{
    if (!isDevelopment)
    {
        throw new InvalidOperationException(
            "JWT_SIGNING_KEY must be set outside Development. Refusing to start without auth configured.");
    }

    // TODO(auth): dev-only placeholder key; never used outside Development. Long enough
    // to satisfy the ≥32-byte HS256 minimum enforced below.
    signingKey = "dev-only-insecure-signing-key-0123456789abcdef";
}

// HS256 needs a ≥256-bit key: Microsoft.IdentityModel rejects shorter SymmetricSecurityKeys
// at signing time, so a short key would boot fine and then 500 on every login. Fail fast
// instead (JwtTokenIssuer repeats the check as defense in depth).
if (Encoding.UTF8.GetByteCount(signingKey) < JwtTokenIssuer.MinSigningKeyBytes)
{
    throw new InvalidOperationException(
        $"JWT_SIGNING_KEY must be at least {JwtTokenIssuer.MinSigningKeyBytes} UTF-8 bytes (256 bits) " +
        "for HS256 signing. Refusing to start with a key that would fail on every login.");
}

// Issues the tokens /auth/login returns; validated by AddJwtBearer below (same key).
builder.Services.AddSingleton(new JwtTokenIssuer(signingKey));

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
            // TODO(auth): set ValidIssuer/ValidAudience once the token issuer exists.
            ValidateIssuer = false,
            ValidateAudience = false,
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy(AuthConstants.ApiPolicy, policy =>
    {
        if (isDevelopment)
        {
            // Explicitly anonymous in Development: tenant scoping still applies via
            // the X-Tenant-Id header (DevHeaderTenantContext). See TODO(auth) above.
            policy.RequireAssertion(_ => true);
        }
        else
        {
            policy.RequireAuthenticatedUser();
        }
    });
});

// ---------------------------------------------------------------------------
// Reverse-proxy support (opt-in). Behind the VPS reverse proxy (Caddy) every request
// arrives from the proxy's IP, so the per-IP login rate limiter below degrades to one
// shared bucket unless X-Forwarded-For is honored. DEPLOYMENT REQUIREMENT: when running
// behind a proxy, set ForwardedHeaders__Enabled=true and name the proxy in
// ForwardedHeaders__KnownProxies / ForwardedHeaders__KnownNetworks (see .env.example).
// Forwarded headers are never trusted unless explicitly enabled and configured.
// ---------------------------------------------------------------------------
var forwardedHeadersEnabled = builder.Configuration.GetValue<bool>("ForwardedHeaders:Enabled");
if (forwardedHeadersEnabled)
{
    builder.Services.Configure<ForwardedHeadersOptions>(options => ForwardedHeadersSetup.Configure(
        options,
        builder.Configuration["ForwardedHeaders:KnownProxies"],
        builder.Configuration["ForwardedHeaders:KnownNetworks"]));
}

// Brute-force protection for /auth/login: fixed window of 10 attempts/min per client IP.
// Partitioned by IP only (not by account email): the partition key callback is synchronous
// and has no parsed request body, so keying on email would require buffering/double-reading
// the body. With forwarded headers configured (above), per-client IP limiting is effective.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy(AuthConstants.LoginRateLimitPolicy, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));
});

const string devCorsPolicy = "dev-cors";
if (isDevelopment)
{
    builder.Services.AddCors(options => options.AddPolicy(devCorsPolicy, policy => policy
        .WithOrigins("http://localhost:5173")
        .AllowAnyHeader()
        .AllowAnyMethod()));
}

var app = builder.Build();

// Must run before UseRateLimiter so the limiter partitions on the real client IP.
if (forwardedHeadersEnabled)
{
    app.UseForwardedHeaders();
}

if (isDevelopment)
{
    app.UseCors(devCorsPolicy);
}

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

var api = app.MapGroup("/api/v1");
api.MapHealthEndpoints();
api.MapAuthEndpoints();
api.MapPropertyEndpoints();
api.MapRecommendationEndpoints();
api.MapEventEndpoints();
api.MapJobEndpoints();
api.MapPoiEndpoints();

// Guarded startup migration: opt-in (docker compose sets Database__MigrateOnStartup=true)
// so plain `dotnet run` works without a database listening.
if (app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();
}

// Demo seeding (shared/contracts/demo-seed.md): opt-in, Development-only, after migrations.
if (app.Configuration.GetValue<bool>("Demo:SeedOnStartup"))
{
    if (!isDevelopment)
    {
        app.Logger.LogWarning(
            "Demo__SeedOnStartup=true is refused outside Development; skipping demo seeding.");
    }
    else
    {
        using var scope = app.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<DemoSeeder>().SeedAsync();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await PoiSeeder.SeedAsync(db, default);
    }
}

await app.RunAsync();

/// <summary>Exposes the entry point to WebApplicationFactory-based tests.</summary>
public partial class Program;
