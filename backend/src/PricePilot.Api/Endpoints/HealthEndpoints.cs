namespace PricePilot.Api.Endpoints;

public static class HealthEndpoints
{
    public static void MapHealthEndpoints(this IEndpointRouteBuilder api)
    {
        // The single anonymous endpoint: liveness/readiness probe.
        api.MapGet("/health", () => Results.Ok(new { status = "ok" }))
            .AllowAnonymous();
    }
}
