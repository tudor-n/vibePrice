using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PricePilot.Application;
using PricePilot.Domain;

namespace PricePilot.Infrastructure.Services;

public sealed class PropertyService(AppDbContext db, ITenantContext tenantContext) : IPropertyService
{
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

    public async Task<RoomTypeDto?> AddRoomTypeAsync(Guid propertyId, RoomTypeCreateDto dto, CancellationToken ct)
    {
        var tenantId = tenantContext.TenantId
            ?? throw new InvalidOperationException("Cannot create a room type without a resolved tenant.");
        var propertyExists = await db.Properties.AsNoTracking().AnyAsync(p => p.Id == propertyId, ct);
        if (!propertyExists) return null; // tenant filter => foreign id is simply not found

        var roomType = new RoomType
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            PropertyId = propertyId,
            Name = dto.Name.Trim(),
            Capacity = dto.Capacity,
            BasePrice = dto.BasePrice,
            CurrentPrice = dto.CurrentPrice ?? dto.BasePrice,
            Currency = (dto.Currency ?? "RON").ToUpperInvariant(),
        };
        db.RoomTypes.Add(roomType);
        await db.SaveChangesAsync(ct);
        return new RoomTypeDto(roomType.Id, roomType.Name, roomType.Capacity,
            roomType.BasePrice, roomType.CurrentPrice, roomType.Currency);
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

        // Bound the DB fetch to stay dates from today forward. Competitor rates are only shown for
        // upcoming stays, so this pushes a `WHERE stay_date >= @today` predicate to the DB and caps
        // the materialized set at the booking horizon (~a year of dates) rather than total scrape
        // history — the scraper appends continuously, so an unbounded fetch would grow without limit.
        // We deliberately do NOT filter on captured_at: the latest capture for an in-scope stay_date
        // may be old (a date the scraper stopped tracking), and dropping it would lose that rate.
        // stay_date is a `date` (DateOnly) — comparable/orderable on both Postgres and SQLite; the
        // SQLite test provider cannot translate ORDER BY over captured_at (DateTimeOffset), which is
        // why the "latest per (competitor, stay_date)" pick is resolved in memory over this bounded set.
        var horizonStart = DateOnly.FromDateTime(DateTime.UtcNow.Date);
        var rates = await db.ScrapedRates
            .AsNoTracking()
            .Where(r => competitorIds.Contains(r.CompetitorId) && r.StayDate >= horizonStart)
            .ToListAsync(ct);

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
            : IsFailedSentinel(property.PlaceCandidates) ? "failed"
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

    // The dataplane writes the bare Python string "__failed__" into the jsonb
    // place_candidates column when place resolution fails. Postgres/Npgsql round-trips
    // jsonb back to C# as the raw JSON text, i.e. the QUOTED scalar `"__failed__"`
    // (12 chars incl. quotes); SQLite (used in unit tests) stores whatever C# string was
    // seeded, i.e. the BARE form `__failed__` (invalid JSON on its own). Both must be
    // recognized as the failure sentinel.
    private static bool IsFailedSentinel(string? placeCandidates)
    {
        if (string.IsNullOrWhiteSpace(placeCandidates))
        {
            return false;
        }

        var trimmed = placeCandidates.Trim();
        return trimmed == "__failed__" || trimmed == "\"__failed__\"";
    }

    private static IReadOnlyList<PlaceCandidateDto> DeserializeCandidates(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                // Covers the failure sentinel (a JSON string scalar) and any other
                // non-array jsonb content — never a candidate list, so never throw.
                return [];
            }

            return JsonSerializer.Deserialize<List<PlaceCandidateDto>>(json, CandidateJsonOptions) ?? [];
        }
        catch (JsonException)
        {
            // Invalid JSON (e.g. the bare __failed__ sentinel as seeded verbatim in
            // SQLite tests) is not a candidate list either.
            return [];
        }
    }
}
