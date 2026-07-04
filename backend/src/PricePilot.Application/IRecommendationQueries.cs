using PricePilot.Domain;

namespace PricePilot.Application;

public enum RecommendationStatusUpdateResult
{
    Updated,
    NotFound,
    InvalidTransition,
}

/// <summary>Tenant-scoped recommendation reads + the single status write the backend owns.</summary>
public interface IRecommendationQueries
{
    /// <summary>
    /// Recommendations for a property in a stay-date range.
    /// Returns null when the property does not exist for the current tenant.
    /// </summary>
    Task<IReadOnlyList<RecommendationDto>?> ListForPropertyAsync(
        Guid propertyId,
        DateOnly? from,
        DateOnly? to,
        CancellationToken ct);

    /// <summary>
    /// Applies pending -> accepted/dismissed. Tenant ownership is enforced by the global
    /// query filter: another tenant's recommendation id yields NotFound.
    /// </summary>
    Task<RecommendationStatusUpdateResult> UpdateStatusAsync(
        Guid recommendationId,
        RecommendationStatus newStatus,
        CancellationToken ct);
}
