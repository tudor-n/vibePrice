namespace PricePilot.Domain;

/// <summary>
/// Dataplane INSERTs new rows; backend UPDATEs status only (pending -> accepted/dismissed).
/// See shared/contracts/table-ownership.md.
/// </summary>
public class Recommendation : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid PropertyId { get; set; }
    public Guid RoomTypeId { get; set; }
    public DateOnly StayDate { get; set; }
    public decimal CurrentPrice { get; set; }
    public decimal RecommendedPrice { get; set; }
    public required string Currency { get; set; }
    public decimal ExpectedImpact { get; set; }

    /// <summary>JSONB reasoning payload; shape defined in shared/contracts/recommendation-factors.md.</summary>
    public required string Factors { get; set; }

    public RecommendationStatus Status { get; set; } = RecommendationStatus.Pending;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }

    /// <summary>
    /// The only legal transitions are pending -> accepted and pending -> dismissed.
    /// A decided recommendation can never change again.
    /// </summary>
    public bool CanTransitionTo(RecommendationStatus next) =>
        Status == RecommendationStatus.Pending && next != RecommendationStatus.Pending;

    /// <summary>Applies a status decision, or returns false if the transition is illegal.</summary>
    public bool TryTransitionTo(RecommendationStatus next, DateTimeOffset decidedAt)
    {
        if (!CanTransitionTo(next))
        {
            return false;
        }

        Status = next;
        DecidedAt = decidedAt;
        return true;
    }
}
