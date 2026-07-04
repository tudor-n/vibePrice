using Microsoft.Extensions.DependencyInjection;
using PricePilot.Connectors;
using Xunit;

namespace PricePilot.UnitTests;

public class ConnectorRegistrationTests
{
    private static ServiceProvider BuildProvider() =>
        new ServiceCollection()
            .AddLogging()
            .AddConnectors()
            .BuildServiceProvider();

    [Fact]
    public void Notification_connector_stubs_resolve_from_di()
    {
        using var provider = BuildProvider();

        var connectors = provider.GetServices<INotificationConnector>().ToList();

        Assert.Equal(2, connectors.Count);
        Assert.Contains(connectors, c => c is EmailConnector && c.Channel == NotificationChannel.Email);
        Assert.Contains(connectors, c => c is WhatsAppConnector && c.Channel == NotificationChannel.WhatsApp);
    }

    [Fact]
    public void Channel_connector_stubs_resolve_from_di()
    {
        using var provider = BuildProvider();

        var connectors = provider.GetServices<IChannelConnector>().ToList();

        Assert.Equal(2, connectors.Count);
        Assert.Contains(connectors, c => c is BookingChannelConnector && c.Channel == "booking.com");
        Assert.Contains(connectors, c => c is AirbnbChannelConnector && c.Channel == "airbnb");
    }

    [Fact]
    public async Task Stub_connectors_complete_without_side_effects()
    {
        using var provider = BuildProvider();

        var message = new NotificationMessage(
            "owner@example.com",
            "Price recommendation",
            "FITS runs Jun 12-21; recommend 420 RON.",
            NotificationChannel.Email);
        foreach (var connector in provider.GetServices<INotificationConnector>())
        {
            await connector.SendAsync(message, CancellationToken.None);
        }

        var push = new PricePush("prop-ext-1", "room-ext-1", new DateOnly(2026, 6, 15), 420m, "RON");
        foreach (var connector in provider.GetServices<IChannelConnector>())
        {
            await connector.PushPriceAsync(push, CancellationToken.None);
        }
    }
}
