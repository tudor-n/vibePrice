using PricePilot.Api.Auth;
using PricePilot.Application;

namespace PricePilot.Api.Endpoints;

public static class PropertyEndpoints
{
    public static void MapPropertyEndpoints(this IEndpointRouteBuilder api)
    {
        var group = api.MapGroup("/properties").RequireAuthorization(AuthConstants.ApiPolicy);

        group.MapGet("/", async (IPropertyService properties, CancellationToken ct) =>
            Results.Ok(await properties.ListAsync(ct)));

        group.MapPost("/", async (
            PropertyCreateDto dto,
            IPropertyService properties,
            ITenantContext tenant,
            CancellationToken ct) =>
        {
            if (tenant.TenantId is null)
            {
                return Results.Unauthorized();
            }

            if (string.IsNullOrWhiteSpace(dto.Name) || string.IsNullOrWhiteSpace(dto.City))
            {
                return Results.BadRequest(new { error = "name and city are required" });
            }

            var created = await properties.CreateAsync(dto, ct);
            return Results.Created($"/api/v1/properties/{created.Id}", created);
        });

        group.MapGet("/{propertyId:guid}/competitors", async (
            Guid propertyId,
            IPropertyService properties,
            CancellationToken ct) =>
        {
            var competitors = await properties.ListCompetitorsAsync(propertyId, ct);
            return competitors is null ? Results.NotFound() : Results.Ok(competitors);
        });

        group.MapPost("/{propertyId:guid}/competitors", async (
            Guid propertyId,
            CompetitorCreateDto dto,
            IPropertyService properties,
            ITenantContext tenant,
            CancellationToken ct) =>
        {
            if (tenant.TenantId is null)
            {
                return Results.Unauthorized();
            }

            if (string.IsNullOrWhiteSpace(dto.Name) || string.IsNullOrWhiteSpace(dto.SourceUrl))
            {
                return Results.BadRequest(new { error = "name and sourceUrl are required" });
            }

            var created = await properties.AddCompetitorAsync(propertyId, dto, ct);
            return created is null
                ? Results.NotFound()
                : Results.Created($"/api/v1/properties/{propertyId}/competitors", created);
        });

        group.MapGet("/{propertyId:guid}/recommendations", async (
            Guid propertyId,
            DateOnly? from,
            DateOnly? to,
            IRecommendationQueries recommendations,
            CancellationToken ct) =>
        {
            var result = await recommendations.ListForPropertyAsync(propertyId, from, to, ct);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });
    }
}
