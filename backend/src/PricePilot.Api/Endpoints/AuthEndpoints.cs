using PricePilot.Api.Auth;
using PricePilot.Application;

namespace PricePilot.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder api)
    {
        // Anonymous by design (like /health): this is where tokens come from.
        // Brute-force protection: fixed-window rate limit per client IP (Program.cs).
        api.MapPost("/auth/login", async (
            LoginRequestDto request,
            IAuthService auth,
            JwtTokenIssuer tokens,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
            {
                return InvalidCredentials();
            }

            var user = await auth.LoginAsync(request.Email, request.Password, ct);
            if (user is null)
            {
                return InvalidCredentials();
            }

            var (token, expiresAt) = tokens.Issue(user);
            return Results.Ok(new LoginResponseDto(token, expiresAt, user));
        })
        .AllowAnonymous()
        .RequireRateLimiting(AuthConstants.LoginRateLimitPolicy);
    }

    /// <summary>
    /// Uniform 401 for every invalid credential shape — unknown email, wrong password and
    /// missing fields must be indistinguishable (no user enumeration).
    /// </summary>
    private static IResult InvalidCredentials() =>
        Results.Json(new { error = "Invalid email or password." }, statusCode: StatusCodes.Status401Unauthorized);
}
