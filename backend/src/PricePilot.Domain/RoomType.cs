namespace PricePilot.Domain;

public class RoomType : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid PropertyId { get; set; }
    public required string Name { get; set; }
    public int Capacity { get; set; }

    /// <summary>Money is always decimal (numeric(10,2) in Postgres). Never double/float.</summary>
    public decimal BasePrice { get; set; }
    public decimal CurrentPrice { get; set; }

    /// <summary>ISO 4217, char(3).</summary>
    public required string Currency { get; set; }
}
