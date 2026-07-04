namespace PricePilot.Domain;

/// <summary>City-scoped public stats time series (INS, weather, holidays). Written by the dataplane only.</summary>
public class DemandSignal
{
    public Guid Id { get; set; }
    public required string City { get; set; }
    public required string SignalType { get; set; }
    public DateOnly SignalDate { get; set; }
    public decimal Value { get; set; }
    public required string Source { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
