using Microsoft.EntityFrameworkCore;
using PricePilot.Application;

namespace PricePilot.Infrastructure.Services;

public sealed class EventQueries(AppDbContext db) : IEventQueries
{
    private const int MaxResults = 500;

    public async Task<IReadOnlyList<EventDto>> ListAsync(string city, DateOnly? from, DateOnly? to, CancellationToken ct)
    {
        var query = db.Events
            .AsNoTracking()
            .Where(e => e.City == city);

        if (from is { } fromDate)
        {
            query = query.Where(e => e.EndDate >= fromDate);
        }

        if (to is { } toDate)
        {
            query = query.Where(e => e.StartDate <= toDate);
        }

        var rows = await query
            .OrderBy(e => e.StartDate)
            .Take(MaxResults)
            .ToListAsync(ct);

        return rows
            .Select(e => new EventDto(e.Id, e.City, e.Name, e.StartDate, e.EndDate, e.ImpactScore))
            .ToList();
    }
}
