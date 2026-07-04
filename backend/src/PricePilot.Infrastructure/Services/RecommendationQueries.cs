using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PricePilot.Application;
using PricePilot.Domain;

namespace PricePilot.Infrastructure.Services;

public sealed class RecommendationQueries(AppDbContext db) : IRecommendationQueries
{
    /// <summary>Pagination guard: a property/date-range query never returns more rows than this.</summary>
    private const int MaxResults = 500;

    /// <summary>Default horizon when no date range is supplied.</summary>
    private const int DefaultHorizonDays = 90;

    public async Task<IReadOnlyList<RecommendationDto>?> ListForPropertyAsync(
        Guid propertyId,
        DateOnly? from,
        DateOnly? to,
        CancellationToken ct)
    {
        var propertyExists = await db.Properties.AsNoTracking().AnyAsync(p => p.Id == propertyId, ct);
        if (!propertyExists)
        {
            return null;
        }

        var fromDate = from ?? DateOnly.FromDateTime(DateTime.UtcNow.Date);
        var toDate = to ?? fromDate.AddDays(DefaultHorizonDays);

        var rows = await db.Recommendations
            .AsNoTracking()
            .Where(r => r.PropertyId == propertyId && r.StayDate >= fromDate && r.StayDate <= toDate)
            .OrderBy(r => r.StayDate)
            .ThenBy(r => r.RoomTypeId)
            .Take(MaxResults)
            .ToListAsync(ct);

        return rows.Select(ToDto).ToList();
    }

    public async Task<RecommendationStatusUpdateResult> UpdateStatusAsync(
        Guid recommendationId,
        RecommendationStatus newStatus,
        CancellationToken ct)
    {
        // The global query filter scopes this lookup to the current tenant, so a foreign
        // recommendation id is indistinguishable from a missing one (NotFound).
        var recommendation = await db.Recommendations.FirstOrDefaultAsync(r => r.Id == recommendationId, ct);
        if (recommendation is null)
        {
            return RecommendationStatusUpdateResult.NotFound;
        }

        if (!recommendation.TryTransitionTo(newStatus, DateTimeOffset.UtcNow))
        {
            return RecommendationStatusUpdateResult.InvalidTransition;
        }

        await db.SaveChangesAsync(ct);
        return RecommendationStatusUpdateResult.Updated;
    }

    private static RecommendationDto ToDto(Recommendation r) =>
        new(
            r.Id,
            r.RoomTypeId,
            r.StayDate,
            r.CurrentPrice,
            r.RecommendedPrice,
            r.Currency,
            r.ExpectedImpact,
            r.Status.ToString().ToLowerInvariant(),
            ParseJson(r.Factors),
            r.CreatedAt);

    private static JsonElement? ParseJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
