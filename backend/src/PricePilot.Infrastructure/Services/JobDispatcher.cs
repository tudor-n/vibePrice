using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PricePilot.Application;
using PricePilot.Domain;

namespace PricePilot.Infrastructure.Services;

public sealed class JobDispatcher(AppDbContext db) : IJobDispatcher
{
    public async Task<JobDto> EnqueueAsync(string type, JsonElement? payload, Guid? requestedBy, CancellationToken ct)
    {
        if (!JobTypes.IsValid(type))
        {
            throw new ArgumentException($"Unknown job type '{type}'. See shared/contracts/jobs.md.", nameof(type));
        }

        var job = new Job
        {
            Id = Guid.NewGuid(),
            Type = type,
            Payload = payload?.GetRawText() ?? "{}",
            Status = JobStatus.Queued,
            CreatedAt = DateTimeOffset.UtcNow,
            RequestedBy = requestedBy,
        };

        db.Jobs.Add(job);
        await db.SaveChangesAsync(ct);

        return ToDto(job);
    }

    public async Task<JobDto?> GetAsync(Guid jobId, CancellationToken ct)
    {
        var job = await db.Jobs.AsNoTracking().FirstOrDefaultAsync(j => j.Id == jobId, ct);
        return job is null ? null : ToDto(job);
    }

    private static JobDto ToDto(Job job) =>
        new(
            job.Id,
            job.Type,
            job.Status.ToString().ToLowerInvariant(),
            job.CreatedAt,
            job.FinishedAt,
            job.Error);
}
