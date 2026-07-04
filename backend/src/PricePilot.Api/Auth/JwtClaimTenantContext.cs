using PricePilot.Application;

namespace PricePilot.Api.Auth;

/// <summary>Production tenant resolution: the tenant_id claim of the validated JWT bearer principal.</summary>
public sealed class JwtClaimTenantContext(IHttpContextAccessor accessor) : ITenantContext
{
    public Guid? TenantId =>
        accessor.HttpContext?.User.FindFirst(AuthConstants.TenantClaim)?.Value is { } value
        && Guid.TryParse(value, out var tenantId)
            ? tenantId
            : null;
}
