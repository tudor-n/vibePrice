using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using PricePilot.Application;

namespace PricePilot.Infrastructure;

/// <summary>
/// Used only by `dotnet ef` at design time (migrations). The hardcoded connection string
/// is never used at runtime — runtime config comes from ConnectionStrings__Default.
/// </summary>
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql("Host=localhost;Port=5432;Database=pricepilot;Username=pricepilot;Password=pricepilot")
            .UseSnakeCaseNamingConvention()
            .Options;

        return new AppDbContext(options, new DesignTimeTenantContext());
    }

    private sealed class DesignTimeTenantContext : ITenantContext
    {
        public Guid? TenantId => null;
    }
}
