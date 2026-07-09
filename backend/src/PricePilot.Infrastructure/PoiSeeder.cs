using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;
using System.Text;
using PricePilot.Domain;

namespace PricePilot.Infrastructure;

/// <summary>
/// Seeds the demo city's (sibiu) points of interest used by the proximity rule. Dev/demo
/// only: Program.cs runs it alongside DemoSeeder when Demo__SeedOnStartup=true AND the
/// environment is Development, after migrations.
///
/// Idempotent by construction: each row's id is a deterministic hash of "poi|city|name"
/// (mirrors DemoSeeder's fixed-key insert-if-missing style), so re-running never duplicates.
///
/// Coordinates below are approximate placeholders good enough for the demo's proximity
/// ordering, not surveyed truth — refined against Google during live verification.
/// </summary>
public static class PoiSeeder
{
    private static readonly (string City, string Name, decimal Lat, decimal Lng, int Weight)[] Seed =
    [
        ("sibiu", "Piața Mare",        45.797300m, 24.152100m, 100),
        ("sibiu", "Piața Mică",        45.798100m, 24.151300m, 90),
        ("sibiu", "Podul Minciunilor", 45.798400m, 24.151000m, 70),
        ("sibiu", "Muzeul Brukenthal", 45.797100m, 24.151700m, 80),
        ("sibiu", "Centru istoric",    45.797600m, 24.151600m, 100),
    ];

    public static async Task SeedAsync(AppDbContext db, CancellationToken ct)
    {
        foreach (var (city, name, lat, lng, weight) in Seed)
        {
            var id = DeterministicId(city, name);
            if (await db.PointsOfInterest.AnyAsync(p => p.Id == id, ct)) continue;
            db.PointsOfInterest.Add(new PointOfInterest
            {
                Id = id, City = city, Name = name, Latitude = lat, Longitude = lng,
                Weight = weight, CreatedAt = DateTimeOffset.UtcNow,
            });
        }
        await db.SaveChangesAsync(ct);
    }

    private static Guid DeterministicId(string city, string name)
    {
        var bytes = MD5.HashData(Encoding.UTF8.GetBytes($"poi|{city}|{name}"));
        return new Guid(bytes);
    }
}
