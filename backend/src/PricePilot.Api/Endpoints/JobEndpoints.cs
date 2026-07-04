using System.Security.Claims;
using System.Text.Json;
using PricePilot.Api.Auth;
using PricePilot.Application;

namespace PricePilot.Api.Endpoints;

public static class JobEndpoints
{
    public sealed record JobCreateRequest(string Type, JsonElement? Payload);

    public static void MapJobEndpoints(this IEndpointRouteBuilder api)
    {
        var group = api.MapGroup("/jobs").RequireAuthorization(AuthConstants.ApiPolicy);

        group.MapPost("/", async (
            JobCreateRequest request,
            IJobDispatcher jobs,
            ClaimsPrincipal user,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Type) || !JobTypes.IsValid(request.Type))
            {
                return Results.BadRequest(new
                {
                    error = $"type must be one of: {string.Join(", ", JobTypes.All)} (see shared/contracts/jobs.md)",
                });
            }

            var requestedBy = user.FindFirst(ClaimTypes.NameIdentifier)?.Value is { } sub
                && Guid.TryParse(sub, out var userId)
                    ? userId
                    : (Guid?)null;

            var job = await jobs.EnqueueAsync(request.Type, request.Payload, requestedBy, ct);
            return Results.Accepted($"/api/v1/jobs/{job.Id}", job);
        });

        group.MapGet("/{jobId:guid}", async (Guid jobId, IJobDispatcher jobs, CancellationToken ct) =>
        {
            var job = await jobs.GetAsync(jobId, ct);
            return job is null ? Results.NotFound() : Results.Ok(job);
        });
    }
}
