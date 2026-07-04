namespace PricePilot.Application;

/// <summary>
/// Credential verification. Implemented in Infrastructure (EF + password hashing);
/// token issuance stays in the Api layer (it is HTTP/auth wiring, not business logic).
/// </summary>
public interface IAuthService
{
    /// <summary>
    /// Verifies email + password and returns the user's identity, or null when the
    /// credentials are invalid. Callers MUST NOT distinguish "unknown email" from
    /// "wrong password" (no user enumeration).
    /// </summary>
    Task<UserInfoDto?> LoginAsync(string email, string password, CancellationToken ct = default);
}
