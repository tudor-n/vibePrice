namespace PricePilot.Domain;

/// <summary>One row per scraper execution. Written by the dataplane only. Not tenant-scoped.</summary>
public class ScrapeRun
{
    public Guid Id { get; set; }
    public required string Source { get; set; }
    public required string Status { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }
    public string? Error { get; set; }
}
