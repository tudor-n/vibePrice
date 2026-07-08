using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PricePilot.Application;
using PricePilot.Domain;

namespace PricePilot.Infrastructure.Services;

public sealed class PropertyService(AppDbContext db, ITenantContext tenantContext) : IPropertyService
{
    /// <summary>Latest scraped rates returned per competitor; scaffold-level freshness window.</summary>
    private const int MaxRatesPerCompetitor = 90;

    public async Task<IReadOnlyList<PropertyDto>> ListAsync(CancellationToken ct)
    {
        var properties = await db.Properties
            .AsNoTracking()
            .OrderBy(p => p.Name)
            .ToListAsync(ct);

        var propertyIds = properties.Select(p => p.Id).ToList();
        var roomTypes = await db.RoomTypes
            .AsNoTracking()
            .Where(rt => propertyIds.Contains(rt.PropertyId))
            .OrderBy(rt => rt.Name)
            .ToListAsync(ct);

        var byProperty = roomTypes.ToLookup(rt => rt.PropertyId);
        return properties
            .Select(p => ToDto(p, byProperty[p.Id]))
            .ToList();
    }

    public async Task<PropertyDto> CreateAsync(PropertyCreateDto dto, CancellationToken ct)
    {
        var tenantId = tenantContext.TenantId
            ?? throw new InvalidOperationException("Cannot create a property without a resolved tenant.");

        var property = new Property
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            Name = dto.Name,
            City = dto.City,
            Address = dto.Address,
            CreatedAt = DateTimeOffset.UtcNow,
        };

        db.Properties.Add(property);
        await db.SaveChangesAsync(ct);

        return ToDto(property, []);
    }

    public Task<bool> ExistsAsync(Guid propertyId, CancellationToken ct) =>
        db.Properties.AsNoTracking().AnyAsync(p => p.Id == propertyId, ct);

    public async Task<IReadOnlyList<CompetitorDto>?> ListCompetitorsAsync(Guid propertyId, CancellationToken ct)
    {
        var propertyExists = await db.Properties.AsNoTracking().AnyAsync(p => p.Id == propertyId, ct);
        if (!propertyExists)
        {
            return null;
        }

        var competitors = await db.Competitors
            .AsNoTracking()
            .Where(c => c.PropertyId == propertyId && c.ExcludedAt == null)
            .OrderBy(c => c.Name)
            .ToListAsync(ct);

        var competitorIds = competitors.Select(c => c.Id).ToList();
        // Sorted client-side (LINQ to Objects): SQLite's provider (unit tests) cannot translate
        // ORDER BY over DateTimeOffset columns; Postgres (production) has no such restriction.
        var rates = (await db.ScrapedRates
            .AsNoTracking()
            .Where(r => competitorIds.Contains(r.CompetitorId))
            .ToListAsync(ct))
            .OrderByDescending(r => r.CapturedAt)
            .Take(MaxRatesPerCompetitor * Math.Max(competitorIds.Count, 1))
            .ToList();

        // Latest capture per (competitor, stay date), resolved in memory over the recent window.
        var latestByCompetitor = rates
            .GroupBy(r => (r.CompetitorId, r.StayDate))
            .Select(g => g.OrderByDescending(r => r.CapturedAt).First())
            .ToLookup(r => r.CompetitorId);

        return competitors
            .Select(c => new CompetitorDto(
                c.Id,
                c.Name,
                c.SourceUrl,
                c.Rating,
                c.RatingCount,
                c.Latitude,
                c.Longitude,
                latestByCompetitor[c.Id]
                    .OrderBy(r => r.StayDate)
                    .Select(r => new CompetitorRateDto(r.StayDate, r.Price, r.Currency, r.CapturedAt))
                    .ToList()))
            .ToList();
    }

    public async Task<bool> UntrackCompetitorAsync(Guid competitorId, CancellationToken ct)
    {
        var competitor = await db.Competitors
            .FirstOrDefaultAsync(c => c.Id == competitorId && c.ExcludedAt == null, ct);
        if (competitor is null) return false; // foreign or already excluded
        competitor.ExcludedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<bool> PickPlaceAsync(Guid propertyId, string placeId, CancellationToken ct)
    {
        var property = await db.Properties.FirstOrDefaultAsync(p => p.Id == propertyId, ct);
        if (property is null) return false; // tenant filter => foreign id is "not found"

        var candidates = DeserializeCandidates(property.PlaceCandidates);
        var chosen = candidates.FirstOrDefault(c => c.PlaceId == placeId)
            ?? throw new PlaceCandidateNotFoundException(placeId);

        property.PlaceId = chosen.PlaceId;
        property.Latitude = chosen.Latitude;
        property.Longitude = chosen.Longitude;
        property.Rating = chosen.Rating;
        property.RatingCount = chosen.RatingCount;
        property.PlaceResolvedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<bool> ClearResolutionForRetryAsync(Guid propertyId, CancellationToken ct) =>
        await db.Properties.AsNoTracking().AnyAsync(p => p.Id == propertyId, ct);

    private static PropertyDto ToDto(Property property, IEnumerable<RoomType> roomTypes)
    {
        var status = property.PlaceResolvedAt is not null ? "resolved"
            : property.PlaceCandidates is "__failed__" ? "failed"
            : "unresolved";
        var candidates = DeserializeCandidates(property.PlaceCandidates);
        return new PropertyDto(
            property.Id, property.Name, property.City, property.Address,
            property.Latitude, property.Longitude, property.Rating, property.RatingCount,
            status, candidates,
            roomTypes.Select(rt => new RoomTypeDto(rt.Id, rt.Name, rt.Capacity, rt.BasePrice, rt.CurrentPrice, rt.Currency)).ToList());
    }

    // place_candidates stores snake_case keys (place_id, formatted_address, rating_count) per
    // shared/contracts/place-candidates.md — the dataplane writes that shape. Map snake_case in;
    // ASP.NET still serializes PlaceCandidateDto OUT as camelCase to the web client.
    private static readonly JsonSerializerOptions CandidateJsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    private static IReadOnlyList<PlaceCandidateDto> DeserializeCandidates(string? json) =>
        string.IsNullOrWhiteSpace(json) || json == "__failed__"
            ? []
            : JsonSerializer.Deserialize<List<PlaceCandidateDto>>(json, CandidateJsonOptions) ?? [];
}
