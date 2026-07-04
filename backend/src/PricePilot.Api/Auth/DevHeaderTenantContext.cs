using PricePilot.Application;

namespace PricePilot.Api.Auth;

/// <summary>
/// TODO(auth): DEVELOPMENT-ONLY STUB — resolves the tenant from the X-Tenant-Id request
/// header with no authentication whatsoever. This class is registered exclusively when
/// ASPNETCORE_ENVIRONMENT=Development (see Program.cs); production uses
/// <see cref="JwtClaimTenantContext"/> and requires a validated JWT. Replace this with a
/// real login flow issuing tenant-scoped JWTs.
/// </summary>
public sealed class DevHeaderTenantContext(IHttpContextAccessor accessor) : ITenantContext
{
    public const string HeaderName = "X-Tenant-Id";

    public Guid? TenantId =>
        accessor.HttpContext?.Request.Headers[HeaderName] is { Count: > 0 } values
        && Guid.TryParse(values.ToString(), out var tenantId)
            ? tenantId
            : null;
}
