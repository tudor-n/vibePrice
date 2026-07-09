namespace PricePilot.Domain;

public class Property : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public required string Name { get; set; }
    public required string City { get; set; }
    public string? Address { get; set; }
    public string? PlaceId { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public decimal? Rating { get; set; }
    public int? RatingCount { get; set; }
    public DateTimeOffset? PlaceResolvedAt { get; set; }
    /// <summary>Top-5 search candidates for the correction picker; JSONB, opaque to the backend.</summary>
    public string? PlaceCandidates { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
