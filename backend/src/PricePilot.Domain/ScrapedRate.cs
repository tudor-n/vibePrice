namespace PricePilot.Domain;

/// <summary>Written by the dataplane only (see shared/contracts/table-ownership.md). Not tenant-scoped.</summary>
public class ScrapedRate
{
    public Guid Id { get; set; }
    public Guid CompetitorId { get; set; }
    public DateOnly StayDate { get; set; }
    public decimal Price { get; set; }
    public required string Currency { get; set; }
    public DateTimeOffset CapturedAt { get; set; }
}
