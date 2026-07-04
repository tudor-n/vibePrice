namespace PricePilot.Domain;

/// <summary>Stored as lowercase strings: pending | accepted | dismissed.</summary>
public enum RecommendationStatus
{
    Pending,
    Accepted,
    Dismissed,
}
