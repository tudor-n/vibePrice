using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
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

    // TODO(auth): dev-only placeholder key; never used outside Development.
    signingKey = "dev-only-insecure-signing-key-0123456789abcdef";
}

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

const string devCorsPolicy = "dev-cors";
if (isDevelopment)
{
    builder.Services.AddCors(options => options.AddPolicy(devCorsPolicy, policy => policy
        .WithOrigins("http://localhost:5173")
        .AllowAnyHeader()
        .AllowAnyMethod()));
}

var app = builder.Build();

if (isDevelopment)
{
    app.UseCors(devCorsPolicy);
}

app.UseAuthentication();
app.UseAuthorization();

var api = app.MapGroup("/api/v1");
api.MapHealthEndpoints();
api.MapPropertyEndpoints();
api.MapRecommendationEndpoints();
api.MapEventEndpoints();
api.MapJobEndpoints();

// Guarded startup migration: opt-in (docker compose sets Database__MigrateOnStartup=true)
// so plain `dotnet run` works without a database listening.
if (app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();
}

await app.RunAsync();
