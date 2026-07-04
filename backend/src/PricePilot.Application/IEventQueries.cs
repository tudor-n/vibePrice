namespace PricePilot.Application;

/// <summary>Events are city-scoped shared data (not tenant-scoped).</summary>
public interface IEventQueries
{
    Task<IReadOnlyList<EventDto>> ListAsync(string city, DateOnly? from, DateOnly? to, CancellationToken ct);
}
