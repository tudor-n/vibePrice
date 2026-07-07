namespace PricePilot.Domain;

public class User : ITenantOwned
{
    /// <summary>
    /// Canonical form of users.email: trimmed + lowercased (invariant culture).
    /// INVARIANT: every write path MUST store this form — the unique index on users.email
    /// (see AppDbContext) is a plain byte-wise index and relies on it for case-insensitive
    /// uniqueness, and login matches by simple equality on the same normalization.
    /// </summary>
    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public required string Email { get; set; }
    public required string DisplayName { get; set; }
    public required string PasswordHash { get; set; }
    public required string Role { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
