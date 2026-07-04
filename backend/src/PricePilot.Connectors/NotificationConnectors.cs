using Microsoft.Extensions.Logging;

namespace PricePilot.Connectors;

/// <summary>NO-OP STUB. Logs and completes; real email delivery is a future feature.</summary>
public sealed class EmailConnector(ILogger<EmailConnector> logger) : INotificationConnector
{
    public NotificationChannel Channel => NotificationChannel.Email;

    public Task SendAsync(NotificationMessage msg, CancellationToken ct)
    {
        logger.LogInformation(
            "EmailConnector stub: would send email to {Recipient} with subject {Subject}",
            msg.Recipient,
            msg.Subject);
        return Task.CompletedTask;
    }
}

/// <summary>NO-OP STUB. Logs and completes; real WhatsApp delivery is a future feature.</summary>
public sealed class WhatsAppConnector(ILogger<WhatsAppConnector> logger) : INotificationConnector
{
    public NotificationChannel Channel => NotificationChannel.WhatsApp;

    public Task SendAsync(NotificationMessage msg, CancellationToken ct)
    {
        logger.LogInformation(
            "WhatsAppConnector stub: would send WhatsApp message to {Recipient}",
            msg.Recipient);
        return Task.CompletedTask;
    }
}
