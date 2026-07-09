namespace PricePilot.Domain;

public class Competitor : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid PropertyId { get; set; }
    public required string Name { get; set; }
    public string? SourceUrl { get; set; }
    public string? PlaceId { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public decimal? Rating { get; set; }
    public int? RatingCount { get; set; }
    public DateTimeOffset? PlaceResolvedAt { get; set; }
    /// <summary>Top-5 search candidates for the correction picker; JSONB, opaque to the backend.</summary>
    public string? PlaceCandidates { get; set; }
    public DateTimeOffset? DiscoveredAt { get; set; }
    public string? DiscoverySource { get; set; }
    public DateTimeOffset? ExcludedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
