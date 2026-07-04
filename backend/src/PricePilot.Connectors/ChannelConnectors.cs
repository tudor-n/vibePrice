using Microsoft.Extensions.Logging;

namespace PricePilot.Connectors;

/// <summary>NO-OP STUB. Logs and completes; real Booking.com price push is a future feature.</summary>
public sealed class BookingChannelConnector(ILogger<BookingChannelConnector> logger) : IChannelConnector
{
    public string Channel => "booking.com";

    public Task PushPriceAsync(PricePush push, CancellationToken ct)
    {
        logger.LogInformation(
            "BookingChannelConnector stub: would push {Price} {Currency} for stay {StayDate} to room {RoomTypeExternalId}",
            push.Price,
            push.Currency,
            push.StayDate,
            push.RoomTypeExternalId);
        return Task.CompletedTask;
    }
}

/// <summary>NO-OP STUB. Logs and completes; real Airbnb price push is a future feature.</summary>
public sealed class AirbnbChannelConnector(ILogger<AirbnbChannelConnector> logger) : IChannelConnector
{
    public string Channel => "airbnb";

    public Task PushPriceAsync(PricePush push, CancellationToken ct)
    {
        logger.LogInformation(
            "AirbnbChannelConnector stub: would push {Price} {Currency} for stay {StayDate} to room {RoomTypeExternalId}",
            push.Price,
            push.Currency,
            push.StayDate,
            push.RoomTypeExternalId);
        return Task.CompletedTask;
    }
}
