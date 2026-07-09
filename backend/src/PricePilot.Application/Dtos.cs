using System.Text.Json;

namespace PricePilot.Application;

// DTOs mirror shared/contracts/openapi.yaml. JSON is serialized camelCase by ASP.NET Core defaults.
// Money is always decimal; stay dates are DateOnly; instants are DateTimeOffset (UTC).

public sealed record RoomTypeDto(
    Guid Id,
    string Name,
    int Capacity,
    decimal BasePrice,
    decimal CurrentPrice,
    string Currency);

public sealed record PlaceCandidateDto(
    string PlaceId, string Name, string? FormattedAddress,
    decimal? Latitude, decimal? Longitude, decimal? Rating, int? RatingCount);

public sealed record PropertyDto(
    Guid Id,
    string Name,
    string City,
    string? Address,
    decimal? Latitude, decimal? Longitude, decimal? Rating, int? RatingCount,
    string PlaceStatus, // "unresolved" | "resolved" | "failed"
    IReadOnlyList<PlaceCandidateDto> PlaceCandidates,
    IReadOnlyList<RoomTypeDto> RoomTypes);

public sealed record PropertyCreateDto(string Name, string City, string? Address);

public sealed record RoomTypeCreateDto(
    string Name, int Capacity, decimal BasePrice, decimal? CurrentPrice, string? Currency);

public sealed record PlacePickDto(string PlaceId);

public sealed record ResolvePlaceDto(string? Query);

public sealed record RecommendationDto(
    Guid Id,
    Guid RoomTypeId,
    DateOnly StayDate,
    decimal CurrentPrice,
    decimal RecommendedPrice,
    string Currency,
    decimal ExpectedImpact,
    string Status,
    JsonElement? Factors,
    DateTimeOffset CreatedAt);

public sealed record CompetitorRateDto(
    DateOnly StayDate,
    decimal Price,
    string Currency,
    DateTimeOffset CapturedAt);

public sealed record CompetitorDto(
    Guid Id,
    string Name,
    string? SourceUrl,
    decimal? Rating,
    int? RatingCount,
    decimal? Latitude,
    decimal? Longitude,
    IReadOnlyList<CompetitorRateDto> LatestRates);

public sealed record EventDto(
    Guid Id,
    string City,
    string Name,
    DateOnly StartDate,
    DateOnly EndDate,
    int ImpactScore);

public sealed record PoiDto(
    Guid Id,
    string City,
    string Name,
    decimal Latitude,
    decimal Longitude,
    int Weight);

public sealed record UserInfoDto(
    Guid Id,
    string Email,
    string DisplayName,
    string Role,
    Guid TenantId);

public sealed record LoginRequestDto(string Email, string Password);

public sealed record LoginResponseDto(string Token, DateTimeOffset ExpiresAt, UserInfoDto User);

public sealed record JobDto(
    Guid Id,
    string Type,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? FinishedAt,
    string? Error);
