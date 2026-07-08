namespace PricePilot.Application;

/// <summary>
/// The only job types the backend may enqueue. Defined in shared/contracts/jobs.md —
/// new job types require updating that file first.
/// </summary>
public static class JobTypes
{
    public const string ScrapeCompetitorRates = "scrape.competitor_rates";
    public const string IngestEvents = "ingest.events";
    public const string IngestDemandSignals = "ingest.demand_signals";
    public const string EngineGenerateRecommendations = "engine.generate_recommendations";
    public const string ResolvePlace = "resolve_place";
    public const string DiscoverCompetitors = "discover_competitors";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        ScrapeCompetitorRates,
        IngestEvents,
        IngestDemandSignals,
        EngineGenerateRecommendations,
        ResolvePlace,
        DiscoverCompetitors,
    };

    public static bool IsValid(string type) => All.Contains(type);
}
