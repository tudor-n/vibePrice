namespace PricePilot.Connectors;

public enum NotificationChannel
{
    Email,
    WhatsApp,
}

public sealed record NotificationMessage(
    string Recipient,
    string Subject,
    string Body,
    NotificationChannel Channel);

/// <summary>
/// Future seam for email/WhatsApp notifications (out of scope in v1 — see the design spec).
/// Only no-op stub implementations exist today.
/// </summary>
public interface INotificationConnector
{
    NotificationChannel Channel { get; }

    Task SendAsync(NotificationMessage msg, CancellationToken ct);
}
