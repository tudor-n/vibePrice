using Microsoft.Extensions.DependencyInjection;

namespace PricePilot.Connectors;

public static class DependencyInjection
{
    /// <summary>Registers the no-op connector stubs. Swap these for real implementations later.</summary>
    public static IServiceCollection AddConnectors(this IServiceCollection services)
    {
        services.AddSingleton<INotificationConnector, EmailConnector>();
        services.AddSingleton<INotificationConnector, WhatsAppConnector>();
        services.AddSingleton<IChannelConnector, BookingChannelConnector>();
        services.AddSingleton<IChannelConnector, AirbnbChannelConnector>();
        return services;
    }
}
