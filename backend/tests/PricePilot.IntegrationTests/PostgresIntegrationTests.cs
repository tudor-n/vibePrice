using Xunit;

namespace PricePilot.IntegrationTests;

/// <summary>
/// Placeholder for real database integration tests (jsonb round-trips, snake_case DDL,
/// migration application, tenant filter against PostgreSQL). These need a live Postgres:
/// run `docker compose up -d db` from the repo root, then remove the Skip.
/// </summary>
public class PostgresIntegrationTests
{
    [Fact(Skip = "Requires PostgreSQL (docker compose up -d db)")]
    public void Migrations_apply_against_a_real_postgres()
    {
        // Intentionally skipped in the scaffold: this suite is the home for tests that
        // exercise AppDbContext against a real PostgreSQL instance, which CI provisions
        // via docker compose. Unit-level behavior is covered in PricePilot.UnitTests.
    }
}
