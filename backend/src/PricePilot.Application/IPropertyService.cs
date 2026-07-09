namespace PricePilot.Application;

/// <summary>Tenant-scoped property and competitor management. All queries run through the tenant filter.</summary>
public interface IPropertyService
{
    Task<IReadOnlyList<PropertyDto>> ListAsync(CancellationToken ct);

    Task<PropertyDto> CreateAsync(PropertyCreateDto dto, CancellationToken ct);

    /// <summary>Returns null when the property does not exist for the current tenant.</summary>
    Task<RoomTypeDto?> AddRoomTypeAsync(Guid propertyId, RoomTypeCreateDto dto, CancellationToken ct);

    /// <summary>True when the property exists for the current tenant (global filter scoped).</summary>
    Task<bool> ExistsAsync(Guid propertyId, CancellationToken ct);

    /// <summary>Returns null when the property does not exist for the current tenant.</summary>
    Task<IReadOnlyList<CompetitorDto>?> ListCompetitorsAsync(Guid propertyId, CancellationToken ct);

    /// <summary>Soft-deletes (sets ExcludedAt) a discovered competitor. Returns false when the
    /// competitor isn't the caller's, or was already excluded (indistinguishable from foreign, both 404).</summary>
    Task<bool> UntrackCompetitorAsync(Guid competitorId, CancellationToken ct);

    /// <summary>Copies the chosen stored candidate's fields onto the property and marks it resolved.
    /// Returns false when the property isn't the caller's; throws <see cref="PlaceCandidateNotFoundException"/>
    /// when placeId isn't among the stored candidates.</summary>
    Task<bool> PickPlaceAsync(Guid propertyId, string placeId, CancellationToken ct);

    /// <summary>Confirms ownership so the endpoint can enqueue a fresh resolve_place job.
    /// Returns false when the property isn't the caller's.</summary>
    Task<bool> ClearResolutionForRetryAsync(Guid propertyId, CancellationToken ct);
}
