using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using PricePilot.Application;
using PricePilot.Domain;

namespace PricePilot.Infrastructure.Services;

/// <summary>
/// Credential verification against users.password_hash (ASP.NET Identity PasswordHasher,
/// PBKDF2). Returns null for ANY invalid credential — callers must not be able to tell
/// "unknown email" from "wrong password" (no user enumeration), and a dummy hash check
/// keeps the two paths similar in timing.
/// </summary>
public sealed class AuthService(AppDbContext db, IPasswordHasher<User> passwordHasher) : IAuthService
{
    // Verified when the email is unknown so both failure paths pay one PBKDF2 cost.
    private static readonly User DummyUser = new()
    {
        Id = Guid.Empty,
        TenantId = Guid.Empty,
        Email = "",
        DisplayName = "",
        PasswordHash = "",
        Role = "",
    };
    private static readonly string DummyHash =
        new PasswordHasher<User>().HashPassword(DummyUser, Guid.NewGuid().ToString("N"));

    public async Task<UserInfoDto?> LoginAsync(string email, string password, CancellationToken ct = default)
    {
        var normalizedEmail = email.Trim().ToLowerInvariant();

        // SYSTEM CODE — deliberate IgnoreQueryFilters: login happens before any tenant is
        // resolved, so the tenant global query filter would hide every user. The lookup is
        // by unique email only and the tenant comes from the matched row itself.
        var user = await db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Email == normalizedEmail, ct);

        if (user is null)
        {
            _ = passwordHasher.VerifyHashedPassword(DummyUser, DummyHash, password);
            return null;
        }

        var result = passwordHasher.VerifyHashedPassword(user, user.PasswordHash, password);
        if (result == PasswordVerificationResult.Failed)
        {
            return null;
        }

        // SuccessRehashNeeded is still a success; rehash-on-login is out of scope for now.
        return new UserInfoDto(user.Id, user.Email, user.DisplayName, user.Role, user.TenantId);
    }
}
