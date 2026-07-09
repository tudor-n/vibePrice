namespace PricePilot.Application;

/// <summary>Points of interest are city-scoped shared data (not tenant-scoped).</summary>
public interface IPoiQueries
{
    Task<IReadOnlyList<PoiDto>> ListByCityAsync(string city, CancellationToken ct);
}
