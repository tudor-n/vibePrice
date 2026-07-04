namespace PricePilot.Domain;

/// <summary>
/// The only backend->dataplane dispatch mechanism. Backend INSERTs; the dataplane
/// claims rows and UPDATEs status/result. See shared/contracts/jobs.md.
/// </summary>
public class Job
{
    public Guid Id { get; set; }
    public required string Type { get; set; }

    /// <summary>JSONB payload; shape per job type in shared/contracts/jobs.md.</summary>
    public required string Payload { get; set; }

    public JobStatus Status { get; set; } = JobStatus.Queued;

    /// <summary>JSONB result set by the dataplane on success.</summary>
    public string? Result { get; set; }

    public string? Error { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }

    /// <summary>User id when triggered from the dashboard.</summary>
    public Guid? RequestedBy { get; set; }
}
