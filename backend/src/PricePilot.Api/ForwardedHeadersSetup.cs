using System.Net;
using Microsoft.AspNetCore.HttpOverrides;
// ForwardedHeadersOptions.KnownNetworks uses the HttpOverrides IPNetwork, not System.Net's.
using IPNetwork = Microsoft.AspNetCore.HttpOverrides.IPNetwork;

namespace PricePilot.Api;

/// <summary>
/// Opt-in X-Forwarded-For support for deployments behind a reverse proxy (the planned
/// VPS Caddy). The login rate limiter partitions on Connection.RemoteIpAddress; without
/// this, every client behind the proxy shares the proxy's IP — one shared 10/min bucket
/// (trivial login DoS) and no per-client brute-force protection.
///
/// Security posture: forwarded headers are NEVER trusted by default. The operator must
/// set ForwardedHeaders__Enabled=true AND list the proxy in ForwardedHeaders__KnownProxies
/// (comma-separated IPs) or ForwardedHeaders__KnownNetworks (comma-separated CIDR).
/// The framework's loopback defaults are cleared so only the configured sources count.
/// </summary>
public static class ForwardedHeadersSetup
{
    /// <summary>
    /// Applies the parsed KnownProxies/KnownNetworks config. Throws (fail fast at startup)
    /// when enabled without any trusted source or when a value does not parse — a silently
    /// misconfigured proxy allowlist would spoof-open the rate limiter.
    /// </summary>
    public static void Configure(ForwardedHeadersOptions options, string? knownProxies, string? knownNetworks)
    {
        var proxies = Split(knownProxies);
        var networks = Split(knownNetworks);
        if (proxies.Length == 0 && networks.Length == 0)
        {
            throw new InvalidOperationException(
                "ForwardedHeaders__Enabled=true requires ForwardedHeaders__KnownProxies (comma-separated IPs) " +
                "and/or ForwardedHeaders__KnownNetworks (comma-separated CIDR) to name the trusted reverse proxy.");
        }

        // Only X-Forwarded-For: the client IP is all the rate limiter needs. Host/proto
        // rewriting stays off until something requires it.
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor;

        // Drop the framework's loopback defaults: trust exactly what is configured.
        options.KnownProxies.Clear();
        options.KnownNetworks.Clear();
        foreach (var proxy in proxies)
        {
            options.KnownProxies.Add(ParseProxy(proxy));
        }

        foreach (var network in networks)
        {
            options.KnownNetworks.Add(ParseNetwork(network));
        }
    }

    private static string[] Split(string? value) =>
        (value ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static IPAddress ParseProxy(string value) =>
        IPAddress.TryParse(value, out var address)
            ? address
            : throw new InvalidOperationException(
                $"ForwardedHeaders__KnownProxies contains '{value}', which is not a valid IP address.");

    private static IPNetwork ParseNetwork(string value)
    {
        var parts = value.Split('/');
        if (parts.Length == 2
            && IPAddress.TryParse(parts[0], out var prefix)
            && int.TryParse(parts[1], out var prefixLength))
        {
            return new IPNetwork(prefix, prefixLength);
        }

        throw new InvalidOperationException(
            $"ForwardedHeaders__KnownNetworks contains '{value}', which is not valid CIDR notation (e.g. 172.18.0.0/16).");
    }
}
