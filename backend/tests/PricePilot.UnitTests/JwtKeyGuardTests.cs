using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using PricePilot.Api.Auth;
using Xunit;

namespace PricePilot.UnitTests;

/// <summary>
/// HS256 signing requires a ≥256-bit (32 UTF-8 bytes) key: Microsoft.IdentityModel enforces
/// this at signing time, so a shorter key would boot fine and then 500 on every login.
/// The app must fail fast at startup instead, and JwtTokenIssuer guards its own input
/// (defense in depth).
/// </summary>
public sealed class JwtKeyGuardTests
{
    private const string ShortKey = "only-20-bytes-key!!!"; // 20 UTF-8 bytes
    private const string MinimalKey = "exactly-32-bytes-key-0123456789a"; // 32 UTF-8 bytes

    [Fact]
    public void Issuer_rejects_keys_shorter_than_32_utf8_bytes()
    {
        var ex = Assert.Throws<ArgumentException>(() => new JwtTokenIssuer(ShortKey));
        Assert.Contains("32", ex.Message);
    }

    [Fact]
    public void Issuer_accepts_a_key_of_exactly_32_utf8_bytes()
    {
        _ = new JwtTokenIssuer(MinimalKey);
    }

    [Fact]
    public void Production_startup_fails_fast_on_a_short_signing_key()
    {
        using var factory = CreateProductionFactory(ShortKey);

        var ex = Record.Exception(() => factory.CreateClient());

        Assert.NotNull(ex);
        Assert.Contains("JWT_SIGNING_KEY", Flatten(ex).Message);
        Assert.Contains("32", Flatten(ex).Message);
    }

    [Fact]
    public void Production_startup_succeeds_with_a_32_byte_signing_key()
    {
        using var factory = CreateProductionFactory(MinimalKey);
        using var client = factory.CreateClient(); // host builds without touching the DB
    }

    private static WebApplicationFactory<Program> CreateProductionFactory(string signingKey) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            // Startup never opens a connection (MigrateOnStartup=false); value just has to exist.
            builder.UseSetting("ConnectionStrings:Default",
                "Host=localhost;Port=5432;Database=unused;Username=unused;Password=unused");
            builder.UseSetting("JWT_SIGNING_KEY", signingKey);
            builder.UseSetting("Database:MigrateOnStartup", "false");
            builder.UseSetting("Demo:SeedOnStartup", "false");
        });

    private static Exception Flatten(Exception ex)
    {
        while (ex is AggregateException { InnerException: not null } aggregate)
        {
            ex = aggregate.InnerException!;
        }

        return ex;
    }
}
