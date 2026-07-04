using PricePilot.Application;

namespace PricePilot.Api.Auth;

/// <summary>
/// DEVELOPMENT-ONLY — registered exclusively when ASPNETCORE_ENVIRONMENT=Development
/// (see Program.cs); production uses <see cref="JwtClaimTenantContext"/> and requires a
/// validated JWT. Resolution order:
/// 1. tenant_id claim of a validated Bearer token (same as production) — takes precedence;
/// 2. the unauthenticated X-Tenant-Id request header (web dev + tooling convenience).
/// </summary>
public sealed class DevHeaderTenantContext(IHttpContextAccessor accessor) : ITenantContext
{
    public const string HeaderName = "X-Tenant-Id";

    public Guid? TenantId
    {
        get
        {
            if (accessor.HttpContext is not { } http)
            {
                return null;
            }

            // Bearer token first: real logins behave identically in Development and production.
            if (http.User.FindFirst(AuthConstants.TenantClaim)?.Value is { } claim
                && Guid.TryParse(claim, out var fromClaim))
            {
                return fromClaim;
            }

            return http.Request.Headers[HeaderName] is { Count: > 0 } values
                && Guid.TryParse(values.ToString(), out var fromHeader)
                    ? fromHeader
                    : null;
        }
    }
}
