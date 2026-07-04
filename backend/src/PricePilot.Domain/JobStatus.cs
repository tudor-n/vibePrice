namespace PricePilot.Domain;

/// <summary>Stored as lowercase strings: queued | running | succeeded | failed. See shared/contracts/jobs.md.</summary>
public enum JobStatus
{
    Queued,
    Running,
    Succeeded,
    Failed,
}
