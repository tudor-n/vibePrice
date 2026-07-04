namespace PricePilot.Domain;

public class Property : ITenantOwned
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public required string Name { get; set; }
    public required string City { get; set; }
    public string? Address { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
