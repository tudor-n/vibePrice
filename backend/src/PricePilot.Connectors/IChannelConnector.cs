namespace PricePilot.Connectors;

public sealed record PricePush(
    string PropertyExternalId,
    string RoomTypeExternalId,
    DateOnly StayDate,
    decimal Price,
    string Currency);

/// <summary>
/// Future seam for pushing accepted prices to OTA channels (Booking.com, Airbnb).
/// Out of scope in v1 — only no-op stub implementations exist today.
/// </summary>
public interface IChannelConnector
{
    /// <summary>Channel identifier, e.g. "booking.com" or "airbnb".</summary>
    string Channel { get; }

    Task PushPriceAsync(PricePush push, CancellationToken ct);
}
