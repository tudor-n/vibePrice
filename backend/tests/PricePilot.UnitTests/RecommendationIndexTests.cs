using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using PricePilot.Application;
using PricePilot.Domain;
using PricePilot.Infrastructure;
using Xunit;

namespace PricePilot.UnitTests;

/// <summary>
/// The engine replaces pending recommendations per (room_type_id, stay_date) in one
/// transaction; a partial unique index makes a concurrent-worker race fail loudly
/// instead of writing duplicate pending rows. Decided rows are exempt (a date's
/// history may hold many accepted/dismissed recommendations).
/// </summary>
public sealed class RecommendationIndexTests : IDisposable
{
    private sealed record FixedTenantContext(Guid? TenantId) : ITenantContext;

    private readonly SqliteConnection _connection;

    public RecommendationIndexTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();
    }

    private AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(_connection)
            .UseSnakeCaseNamingConvention()
            .Options;
        return new AppDbContext(options, new FixedTenantContext(null));
    }

    [Fact]
    public void Pending_recommendations_have_a_partial_unique_index()
    {
        using var db = CreateContext();
        var entity = db.Model.FindEntityType(typeof(Recommendation))!;
        var index = Assert.Single(
            entity.GetIndexes(),
            i => i.Properties.Select(p => p.Name)
                .SequenceEqual(new[] { nameof(Recommendation.RoomTypeId), nameof(Recommendation.StayDate) }));

        Assert.True(index.IsUnique);
        Assert.Equal("status = 'pending'", index.GetFilter());
    }

    public void Dispose() => _connection.Dispose();
}
