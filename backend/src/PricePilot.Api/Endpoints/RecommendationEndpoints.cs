using PricePilot.Api.Auth;
using PricePilot.Application;
using PricePilot.Domain;

namespace PricePilot.Api.Endpoints;

public static class RecommendationEndpoints
{
    public sealed record StatusUpdateRequest(string Status);

    public static void MapRecommendationEndpoints(this IEndpointRouteBuilder api)
    {
        api.MapPost("/recommendations/{recommendationId:guid}/status", async (
                Guid recommendationId,
                StatusUpdateRequest request,
                IRecommendationQueries recommendations,
                CancellationToken ct) =>
            {
                // Only accepted|dismissed are legal decisions (openapi.yaml).
                RecommendationStatus? newStatus = request.Status switch
                {
                    "accepted" => RecommendationStatus.Accepted,
                    "dismissed" => RecommendationStatus.Dismissed,
                    _ => null,
                };

                if (newStatus is null)
                {
                    return Results.BadRequest(new { error = "status must be 'accepted' or 'dismissed'" });
                }

                // Tenant ownership is enforced inside UpdateStatusAsync via the global query
                // filter: another tenant's recommendation id resolves to NotFound.
                var result = await recommendations.UpdateStatusAsync(recommendationId, newStatus.Value, ct);
                return result switch
                {
                    RecommendationStatusUpdateResult.Updated => Results.Ok(new { status = request.Status }),
                    RecommendationStatusUpdateResult.NotFound => Results.NotFound(),
                    _ => Results.Conflict(new { error = "only pending recommendations can be decided" }),
                };
            })
            .RequireAuthorization(AuthConstants.ApiPolicy);
    }
}
