namespace PricePilot.Application;

/// <summary>
/// Ambient tenant of the current request. Implemented in the API layer
/// (JWT claim in production, X-Tenant-Id header in Development only) and consumed
/// by the EF Core global query filter in Infrastructure.
/// </summary>
public interface ITenantContext
{
    /// <summary>Null means "no tenant resolved" — tenant-owned queries must return nothing.</summary>
    Guid? TenantId { get; }
}
