using System.Text.Json;
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
            IJobDispatcher jobs,
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
            using var payloadDoc = JsonDocument.Parse(
                $$"""{"property_id":"{{created.Id}}"}""");
            await jobs.EnqueueAsync(JobTypes.ResolvePlace, payloadDoc.RootElement.Clone(), requestedBy: null, ct);
            return Results.Created($"/api/v1/properties/{created.Id}", created);
        });

        group.MapPost("/{propertyId:guid}/room-types", async (
            Guid propertyId, RoomTypeCreateDto dto, IPropertyService properties,
            ITenantContext tenant, CancellationToken ct) =>
        {
            if (tenant.TenantId is null) return Results.Unauthorized();
            if (string.IsNullOrWhiteSpace(dto.Name)) return Results.BadRequest(new { error = "name is required" });
            if (dto.Capacity < 1) return Results.BadRequest(new { error = "capacity must be at least 1" });
            if (dto.BasePrice <= 0 || decimal.Round(dto.BasePrice, 2) != dto.BasePrice)
                return Results.BadRequest(new { error = "basePrice must be > 0 with at most 2 decimals" });
            if (dto.CurrentPrice is { } cp && (cp <= 0 || decimal.Round(cp, 2) != cp))
                return Results.BadRequest(new { error = "currentPrice must be > 0 with at most 2 decimals" });
            if (dto.Currency is { } cur && cur.Length != 3)
                return Results.BadRequest(new { error = "currency must be a 3-letter code" });

            var created = await properties.AddRoomTypeAsync(propertyId, dto, ct);
            return created is null ? Results.NotFound() : Results.Created($"/api/v1/properties/{propertyId}/room-types", created);
        });

        group.MapGet("/{propertyId:guid}/competitors", async (
            Guid propertyId,
            IPropertyService properties,
            CancellationToken ct) =>
        {
            var competitors = await properties.ListCompetitorsAsync(propertyId, ct);
            return competitors is null ? Results.NotFound() : Results.Ok(competitors);
        });

        group.MapPatch("/{propertyId:guid}/place", async (
            Guid propertyId, PlacePickDto dto, IPropertyService properties, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(dto.PlaceId))
                return Results.BadRequest(new { error = "placeId is required" });
            try
            {
                var ok = await properties.PickPlaceAsync(propertyId, dto.PlaceId, ct);
                if (!ok) return Results.NotFound();
                var updated = (await properties.ListAsync(ct)).First(p => p.Id == propertyId);
                return Results.Ok(updated);
            }
            catch (PlaceCandidateNotFoundException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapPost("/{propertyId:guid}/resolve-place", async (
            Guid propertyId, ResolvePlaceDto? dto, IPropertyService properties,
            IJobDispatcher jobs, CancellationToken ct) =>
        {
            if (!await properties.ClearResolutionForRetryAsync(propertyId, ct))
                return Results.NotFound();
            var query = string.IsNullOrWhiteSpace(dto?.Query) ? null : dto.Query.Trim();
            var json = query is null
                ? $$"""{"property_id":"{{propertyId}}"}"""
                : $$"""{"property_id":"{{propertyId}}","query":{{JsonSerializer.Serialize(query)}}}""";
            using var payloadDoc = JsonDocument.Parse(json);
            var job = await jobs.EnqueueAsync(JobTypes.ResolvePlace, payloadDoc.RootElement.Clone(), null, ct);
            return Results.Accepted($"/api/v1/jobs/{job.Id}", job);
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

        // Competitors are edited by id (discovered, not manually created), so untrack lives on a
        // top-level /competitors route rather than nested under a property.
        var competitors = api.MapGroup("/competitors").RequireAuthorization(AuthConstants.ApiPolicy);
        competitors.MapDelete("/{competitorId:guid}", async (
            Guid competitorId, IPropertyService properties, CancellationToken ct) =>
        {
            var ok = await properties.UntrackCompetitorAsync(competitorId, ct);
            return ok ? Results.NoContent() : Results.NotFound();
        });
    }
}
