namespace PricePilot.Domain;

/// <summary>
/// Marker for entities that belong to a tenant. Every query against these entities
/// is automatically scoped by the EF Core global query filter in AppDbContext.
/// </summary>
public interface ITenantOwned
{
    Guid TenantId { get; }
}
