namespace PricePilot.Api.Auth;

public static class AuthConstants
{
    /// <summary>
    /// Authorization policy applied to every endpoint except /health.
    /// Development: passes anonymously (tenant comes from the X-Tenant-Id header).
    /// Production: requires an authenticated JWT bearer principal.
    /// </summary>
    public const string ApiPolicy = "api";

    /// <summary>Claim carrying the tenant id in production JWTs.</summary>
    public const string TenantClaim = "tenant_id";

    /// <summary>Fixed-window rate limiter policy applied to POST /auth/login (per client IP).</summary>
    public const string LoginRateLimitPolicy = "login";
}
