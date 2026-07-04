namespace PricePilot.Domain;

public class Tenant
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string SubscriptionPlan { get; set; }
    public required string SubscriptionStatus { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
