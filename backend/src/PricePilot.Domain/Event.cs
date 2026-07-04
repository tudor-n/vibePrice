namespace PricePilot.Domain;

/// <summary>City-scoped shared data, NOT tenant-scoped. Written by the dataplane only.</summary>
public class Event
{
    public Guid Id { get; set; }
    public required string City { get; set; }
    public required string Name { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }

    /// <summary>0-100.</summary>
    public int ImpactScore { get; set; }
    public required string Source { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
