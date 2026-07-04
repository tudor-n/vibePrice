using PricePilot.Api.Auth;
using PricePilot.Application;

namespace PricePilot.Api.Endpoints;

public static class EventEndpoints
{
    public static void MapEventEndpoints(this IEndpointRouteBuilder api)
    {
        // city is a required query parameter (non-nullable => automatic 400 when missing).
        api.MapGet("/events", async (
                string city,
                DateOnly? from,
                DateOnly? to,
                IEventQueries events,
                CancellationToken ct) =>
            Results.Ok(await events.ListAsync(city, from, to, ct)))
            .RequireAuthorization(AuthConstants.ApiPolicy);
    }
}
