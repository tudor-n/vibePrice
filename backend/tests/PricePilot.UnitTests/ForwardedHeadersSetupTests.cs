using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.HttpOverrides;
using PricePilot.Api;
using Xunit;

namespace PricePilot.UnitTests;

/// <summary>
/// ForwardedHeadersSetup.Configure parses the ForwardedHeaders__KnownProxies /
/// ForwardedHeaders__KnownNetworks env values. Behind the VPS reverse proxy (Caddy) the
/// login rate limiter partitions on Connection.RemoteIpAddress, so forwarded headers must
/// be honored ONLY from explicitly configured proxies — never by default.
/// </summary>
public sealed class ForwardedHeadersSetupTests
{
    [Fact]
    public void Parses_known_proxies_and_clears_the_loopback_defaults()
    {
        var options = new ForwardedHeadersOptions();

        ForwardedHeadersSetup.Configure(options, "10.0.0.5, 192.168.1.10", null);

        Assert.Equal(
            new[] { IPAddress.Parse("10.0.0.5"), IPAddress.Parse("192.168.1.10") },
            options.KnownProxies);
        // The framework defaults trust loopback; once explicitly configured, ONLY the
        // configured proxies/networks may inject X-Forwarded-For.
        Assert.Empty(options.KnownNetworks);
        Assert.Equal(ForwardedHeaders.XForwardedFor, options.ForwardedHeaders);
    }

    [Fact]
    public void Parses_known_networks_in_cidr_notation()
    {
        var options = new ForwardedHeadersOptions();

        ForwardedHeadersSetup.Configure(options, null, "172.18.0.0/16, 10.0.0.0/8");

        Assert.Equal(2, options.KnownNetworks.Count);
        Assert.Equal(IPAddress.Parse("172.18.0.0"), options.KnownNetworks[0].Prefix);
        Assert.Equal(16, options.KnownNetworks[0].PrefixLength);
        Assert.Equal(IPAddress.Parse("10.0.0.0"), options.KnownNetworks[1].Prefix);
        Assert.Equal(8, options.KnownNetworks[1].PrefixLength);
        Assert.Empty(options.KnownProxies);
    }

    [Fact]
    public void Enabled_without_any_proxy_or_network_fails_fast()
    {
        var options = new ForwardedHeadersOptions();

        var ex = Assert.Throws<InvalidOperationException>(
            () => ForwardedHeadersSetup.Configure(options, "  ", null));
        Assert.Contains("ForwardedHeaders__KnownProxies", ex.Message);
        Assert.Contains("ForwardedHeaders__KnownNetworks", ex.Message);
    }

    [Theory]
    [InlineData("not-an-ip", null)]
    [InlineData(null, "10.0.0.0")] // network without /prefix
    [InlineData(null, "10.0.0.0/xx")]
    public void Malformed_proxy_or_network_fails_fast_naming_the_offending_value(
        string? knownProxies, string? knownNetworks)
    {
        var options = new ForwardedHeadersOptions();

        var ex = Assert.Throws<InvalidOperationException>(
            () => ForwardedHeadersSetup.Configure(options, knownProxies, knownNetworks));
        Assert.Contains((knownProxies ?? knownNetworks)!.Trim(), ex.Message);
    }
}
