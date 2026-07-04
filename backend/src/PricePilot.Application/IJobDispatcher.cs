using System.Text.Json;

namespace PricePilot.Application;

/// <summary>
/// Inserts queued rows into the jobs table — the only backend->dataplane dispatch
/// mechanism (shared/contracts/jobs.md). The dataplane claims and executes them.
/// </summary>
public interface IJobDispatcher
{
    /// <summary>Type must be one of <see cref="JobTypes.All"/>; callers validate first.</summary>
    Task<JobDto> EnqueueAsync(string type, JsonElement? payload, Guid? requestedBy, CancellationToken ct);

    Task<JobDto?> GetAsync(Guid jobId, CancellationToken ct);
}
