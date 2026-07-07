using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using PricePilot.Application;
using PricePilot.Domain;
using PricePilot.Infrastructure;
using Xunit;

namespace PricePilot.UnitTests;

/// <summary>
/// users.email invariant: stored trimmed + lowercased (User.NormalizeEmail) on every
/// write path, backed by a unique index so a plain equality lookup in AuthService is
/// both correct and collision-free — even across tenants.
/// </summary>
public sealed class UserEmailTests : IDisposable
{
    private sealed record FixedTenantContext(Guid? TenantId) : ITenantContext;

    private readonly SqliteConnection _connection;

    public UserEmailTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();
        using var db = CreateContext();
        db.Database.EnsureCreated();
    }

    private AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(_connection)
            .UseSnakeCaseNamingConvention()
            .Options;
        return new AppDbContext(options, new FixedTenantContext(null));
    }

    [Theory]
    [InlineData("demo@pricepilot.local", "demo@pricepilot.local")]
    [InlineData("Demo@PricePilot.LOCAL", "demo@pricepilot.local")]
    [InlineData("  demo@pricepilot.local  ", "demo@pricepilot.local")]
    [InlineData("\tMiXeD@CaSe.Ro \n", "mixed@case.ro")]
    public void NormalizeEmail_trims_and_lowercases_invariant(string input, string expected) =>
        Assert.Equal(expected, User.NormalizeEmail(input));

    [Fact]
    public async Task Duplicate_email_is_rejected_by_the_unique_index_even_across_tenants()
    {
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        await using (var db = CreateContext())
        {
            db.Tenants.Add(new Tenant { Id = tenantA, Name = "A", SubscriptionPlan = "demo", SubscriptionStatus = "active" });
            db.Tenants.Add(new Tenant { Id = tenantB, Name = "B", SubscriptionPlan = "demo", SubscriptionStatus = "active" });
            db.Users.Add(NewUser(tenantA, "owner@example.com"));
            await db.SaveChangesAsync();
        }

        await using (var db = CreateContext())
        {
            // Same normalized email under a DIFFERENT tenant: without a unique index this
            // would let the duplicate log into an arbitrary tenant (login is cross-tenant).
            db.Users.Add(NewUser(tenantB, "owner@example.com"));
            await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        }
    }

    private static User NewUser(Guid tenantId, string email) => new()
    {
        Id = Guid.NewGuid(),
        TenantId = tenantId,
        Email = User.NormalizeEmail(email),
        DisplayName = "Owner",
        PasswordHash = "irrelevant",
        Role = "owner",
    };

    public void Dispose() => _connection.Dispose();
}
