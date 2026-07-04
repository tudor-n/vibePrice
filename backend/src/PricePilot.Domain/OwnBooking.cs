namespace PricePilot.Domain;

/// <summary>Future ingestion of the hotel's own booking history. Schema present, unused in v1.</summary>
public class OwnBooking : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid PropertyId { get; set; }
    public Guid RoomTypeId { get; set; }
    public DateOnly StayDate { get; set; }
    public decimal Price { get; set; }
    public required string Currency { get; set; }
    public DateTimeOffset BookedAt { get; set; }
    public required string Source { get; set; }
}
