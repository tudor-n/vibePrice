using PricePilot.Api.Auth;
using PricePilot.Application;

namespace PricePilot.Api.Endpoints;

public static class PoiEndpoints
{
    public static void MapPoiEndpoints(this IEndpointRouteBuilder api)
    {
        api.MapGet("/points-of-interest", async (string city, IPoiQueries pois, CancellationToken ct) =>
                string.IsNullOrWhiteSpace(city)
                    ? Results.BadRequest(new { error = "city is required" })
                    : Results.Ok(await pois.ListByCityAsync(city, ct)))
            .RequireAuthorization(AuthConstants.ApiPolicy);
    }
}
