namespace PricePilot.Domain;

public class Competitor : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid PropertyId { get; set; }
    public required string Name { get; set; }
    public required string SourceUrl { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
