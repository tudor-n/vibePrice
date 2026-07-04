using System.Text;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using PricePilot.Application;

namespace PricePilot.Api.Auth;

/// <summary>
/// Issues the HS256 bearer tokens that AddJwtBearer in Program.cs validates (same
/// JWT_SIGNING_KEY). Lives in the Api layer on purpose: token format is HTTP/auth wiring,
/// not business logic — Infrastructure only verifies credentials (IAuthService).
/// Claims: sub (user id), tenant_id (consumed by JwtClaimTenantContext), email, role.
/// </summary>
public sealed class JwtTokenIssuer(string signingKey)
{
    /// <summary>Contract value from shared/contracts/openapi.yaml: 12 hour tokens.</summary>
    public static readonly TimeSpan TokenLifetime = TimeSpan.FromHours(12);

    private readonly SigningCredentials _credentials = new(
        new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
        SecurityAlgorithms.HmacSha256);

    public (string Token, DateTimeOffset ExpiresAt) Issue(UserInfoDto user)
    {
        var expiresAt = DateTimeOffset.UtcNow.Add(TokenLifetime);
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Claims = new Dictionary<string, object>
            {
                [JwtRegisteredClaimNames.Sub] = user.Id.ToString(),
                [AuthConstants.TenantClaim] = user.TenantId.ToString(),
                [JwtRegisteredClaimNames.Email] = user.Email,
                ["role"] = user.Role,
            },
            Expires = expiresAt.UtcDateTime,
            SigningCredentials = _credentials,
        });
        return (token, expiresAt);
    }
}
