using Microsoft.EntityFrameworkCore;
using PricePilot.Application;

namespace PricePilot.Infrastructure.Services;

public sealed class PoiQueries(AppDbContext db) : IPoiQueries
{
    public async Task<IReadOnlyList<PoiDto>> ListByCityAsync(string city, CancellationToken ct)
    {
        var norm = city.Trim().ToLowerInvariant();
        return await db.PointsOfInterest.AsNoTracking()
            .Where(p => p.City == norm)
            .OrderByDescending(p => p.Weight).ThenBy(p => p.Name)
            .Select(p => new PoiDto(p.Id, p.City, p.Name, p.Latitude, p.Longitude, p.Weight))
            .ToListAsync(ct);
    }
}
