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

    public async Task<IReadOnlyList<CompetitorDto>?> ListCompetitorsAsync(Guid propertyId, CancellationToken ct)
    {
        var propertyExists = await db.Properties.AsNoTracking().AnyAsync(p => p.Id == propertyId, ct);
        if (!propertyExists)
        {
            return null;
        }

        var competitors = await db.Competitors
            .AsNoTracking()
            .Where(c => c.PropertyId == propertyId)
            .OrderBy(c => c.Name)
            .ToListAsync(ct);

        var competitorIds = competitors.Select(c => c.Id).ToList();
        var rates = await db.ScrapedRates
            .AsNoTracking()
            .Where(r => competitorIds.Contains(r.CompetitorId))
            .OrderByDescending(r => r.CapturedAt)
            .Take(MaxRatesPerCompetitor * Math.Max(competitorIds.Count, 1))
            .ToListAsync(ct);

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
                latestByCompetitor[c.Id]
                    .OrderBy(r => r.StayDate)
                    .Select(r => new CompetitorRateDto(r.StayDate, r.Price, r.Currency, r.CapturedAt))
                    .ToList()))
            .ToList();
    }

    public async Task<CompetitorDto?> AddCompetitorAsync(Guid propertyId, CompetitorCreateDto dto, CancellationToken ct)
    {
        var tenantId = tenantContext.TenantId
            ?? throw new InvalidOperationException("Cannot create a competitor without a resolved tenant.");

        // Ownership check: the tenant filter means another tenant's property id is simply not found.
        var propertyExists = await db.Properties.AsNoTracking().AnyAsync(p => p.Id == propertyId, ct);
        if (!propertyExists)
        {
            return null;
        }

        var competitor = new Competitor
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            PropertyId = propertyId,
            Name = dto.Name,
            SourceUrl = dto.SourceUrl,
            CreatedAt = DateTimeOffset.UtcNow,
        };

        db.Competitors.Add(competitor);
        await db.SaveChangesAsync(ct);

        return new CompetitorDto(competitor.Id, competitor.Name, competitor.SourceUrl, []);
    }

    private static PropertyDto ToDto(Property property, IEnumerable<RoomType> roomTypes) =>
        new(
            property.Id,
            property.Name,
            property.City,
            property.Address,
            roomTypes
                .Select(rt => new RoomTypeDto(rt.Id, rt.Name, rt.Capacity, rt.BasePrice, rt.CurrentPrice, rt.Currency))
                .ToList());
}
