namespace PricePilot.Domain;

/// <summary>City-scoped proximity reference (NOT tenant-owned) — like Event.</summary>
public class PointOfInterest
{
    public Guid Id { get; set; }
    public required string City { get; set; }
    public required string Name { get; set; }
    public decimal Latitude { get; set; }
    public decimal Longitude { get; set; }
    public int Weight { get; set; } // 0..100 importance
    public DateTimeOffset CreatedAt { get; set; }
}
