using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using PricePilot.Application;
using PricePilot.Domain;

namespace PricePilot.Infrastructure;

/// <summary>
/// Single DbContext for the whole app. Conventions (see shared/contracts/table-ownership.md):
/// snake_case identifiers via EFCore.NamingConventions, uuid PKs, timestamptz UTC instants,
/// numeric(10,2) money + char(3) currency, enums stored as lowercase strings, JSONB payloads.
/// Tenant isolation: every ITenantOwned entity carries a global query filter bound to
/// <see cref="ITenantContext"/>. Never call IgnoreQueryFilters() outside admin code.
/// </summary>
public sealed class AppDbContext(DbContextOptions<AppDbContext> options, ITenantContext tenantContext)
    : DbContext(options)
{
    private readonly ITenantContext _tenantContext = tenantContext;

    /// <summary>
    /// Guid.Empty when no tenant is resolved, so tenant-owned queries match nothing
    /// rather than leaking across tenants.
    /// </summary>
    private Guid CurrentTenantId => _tenantContext.TenantId ?? Guid.Empty;

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Property> Properties => Set<Property>();
    public DbSet<RoomType> RoomTypes => Set<RoomType>();
    public DbSet<Competitor> Competitors => Set<Competitor>();
    public DbSet<ScrapedRate> ScrapedRates => Set<ScrapedRate>();
    public DbSet<ScrapeRun> ScrapeRuns => Set<ScrapeRun>();
    public DbSet<Event> Events => Set<Event>();
    public DbSet<DemandSignal> DemandSignals => Set<DemandSignal>();
    public DbSet<Recommendation> Recommendations => Set<Recommendation>();
    public DbSet<OwnBooking> OwnBookings => Set<OwnBooking>();
    public DbSet<Job> Jobs => Set<Job>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var lowercaseRecommendationStatus = LowercaseEnumConverter<RecommendationStatus>();
        var lowercaseJobStatus = LowercaseEnumConverter<JobStatus>();

        modelBuilder.Entity<Tenant>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.SubscriptionPlan).HasMaxLength(50);
            e.Property(x => x.SubscriptionStatus).HasMaxLength(50);
        });

        modelBuilder.Entity<User>(e =>
        {
            e.HasIndex(x => x.TenantId);
            // INVARIANT: emails are stored trimmed + lowercased (User.NormalizeEmail) on
            // every write path, so this plain unique index also guarantees case-insensitive
            // uniqueness and login can match with simple equality (AuthService.LoginAsync).
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.Email).HasMaxLength(320);
            e.Property(x => x.DisplayName).HasMaxLength(200);
            e.Property(x => x.Role).HasMaxLength(50);
            e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId);
        });

        modelBuilder.Entity<Property>(e =>
        {
            e.HasIndex(x => x.TenantId);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.City).HasMaxLength(100);
            e.Property(x => x.Address).HasMaxLength(500);
            e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId);
        });

        modelBuilder.Entity<RoomType>(e =>
        {
            e.HasIndex(x => x.TenantId);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.BasePrice).HasPrecision(10, 2);
            e.Property(x => x.CurrentPrice).HasPrecision(10, 2);
            ConfigureCurrency(e.Property(x => x.Currency));
            e.HasOne<Property>().WithMany().HasForeignKey(x => x.PropertyId);
        });

        modelBuilder.Entity<Competitor>(e =>
        {
            e.HasIndex(x => x.TenantId);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.SourceUrl).HasMaxLength(2000);
            e.HasOne<Property>().WithMany().HasForeignKey(x => x.PropertyId);
        });

        modelBuilder.Entity<ScrapedRate>(e =>
        {
            e.HasIndex(x => new { x.CompetitorId, x.StayDate });
            e.Property(x => x.Price).HasPrecision(10, 2);
            ConfigureCurrency(e.Property(x => x.Currency));
            e.HasOne<Competitor>().WithMany().HasForeignKey(x => x.CompetitorId);
        });

        modelBuilder.Entity<ScrapeRun>(e =>
        {
            e.Property(x => x.Source).HasMaxLength(100);
            e.Property(x => x.Status).HasMaxLength(50);
        });

        modelBuilder.Entity<Event>(e =>
        {
            e.HasIndex(x => new { x.City, x.StartDate });
            e.Property(x => x.City).HasMaxLength(100);
            e.Property(x => x.Name).HasMaxLength(300);
            e.Property(x => x.Source).HasMaxLength(100);
        });

        modelBuilder.Entity<DemandSignal>(e =>
        {
            e.HasIndex(x => new { x.City, x.SignalType, x.SignalDate });
            e.Property(x => x.City).HasMaxLength(100);
            e.Property(x => x.SignalType).HasMaxLength(100);
            e.Property(x => x.Value).HasPrecision(14, 4);
            e.Property(x => x.Source).HasMaxLength(100);
        });

        modelBuilder.Entity<Recommendation>(e =>
        {
            e.HasIndex(x => x.TenantId);
            e.HasIndex(x => new { x.PropertyId, x.StayDate });
            // At most one PENDING recommendation per room type and stay date. The dataplane
            // replaces pending rows per (room_type_id, stay_date) in one transaction; with
            // concurrent workers this turns a race into a loud unique violation instead of
            // duplicate pending rows. Decided rows are exempt (history may repeat a date).
            e.HasIndex(x => new { x.RoomTypeId, x.StayDate })
                .IsUnique()
                .HasFilter("status = 'pending'");
            // Keep the plain FK index explicitly: EF would otherwise drop it as "covered"
            // by the composite above, but a PARTIAL index can't serve room_type_id lookups
            // on decided rows (e.g. the engine's decided-keys query).
            e.HasIndex(x => x.RoomTypeId);
            e.Property(x => x.CurrentPrice).HasPrecision(10, 2);
            e.Property(x => x.RecommendedPrice).HasPrecision(10, 2);
            e.Property(x => x.ExpectedImpact).HasPrecision(10, 2);
            ConfigureCurrency(e.Property(x => x.Currency));
            e.Property(x => x.Factors).HasColumnType("jsonb");
            e.Property(x => x.Status).HasConversion(lowercaseRecommendationStatus).HasMaxLength(20);
            e.HasOne<Property>().WithMany().HasForeignKey(x => x.PropertyId);
            e.HasOne<RoomType>().WithMany().HasForeignKey(x => x.RoomTypeId);
        });

        modelBuilder.Entity<OwnBooking>(e =>
        {
            e.HasIndex(x => x.TenantId);
            e.Property(x => x.Price).HasPrecision(10, 2);
            ConfigureCurrency(e.Property(x => x.Currency));
            e.Property(x => x.Source).HasMaxLength(100);
            e.HasOne<Property>().WithMany().HasForeignKey(x => x.PropertyId);
            e.HasOne<RoomType>().WithMany().HasForeignKey(x => x.RoomTypeId);
        });

        modelBuilder.Entity<Job>(e =>
        {
            e.HasIndex(x => x.Status);
            e.Property(x => x.Type).HasMaxLength(100);
            e.Property(x => x.Payload).HasColumnType("jsonb");
            e.Property(x => x.Result).HasColumnType("jsonb");
            e.Property(x => x.Status).HasConversion(lowercaseJobStatus).HasMaxLength(20);
        });

        // Tenant isolation: global query filters on every ITenantOwned entity.
        // Filters reference CurrentTenantId on the context so they are evaluated per request.
        modelBuilder.Entity<User>().HasQueryFilter(x => x.TenantId == CurrentTenantId);
        modelBuilder.Entity<Property>().HasQueryFilter(x => x.TenantId == CurrentTenantId);
        modelBuilder.Entity<RoomType>().HasQueryFilter(x => x.TenantId == CurrentTenantId);
        modelBuilder.Entity<Competitor>().HasQueryFilter(x => x.TenantId == CurrentTenantId);
        modelBuilder.Entity<Recommendation>().HasQueryFilter(x => x.TenantId == CurrentTenantId);
        modelBuilder.Entity<OwnBooking>().HasQueryFilter(x => x.TenantId == CurrentTenantId);
    }

    private static ValueConverter<TEnum, string> LowercaseEnumConverter<TEnum>()
        where TEnum : struct, Enum =>
        new(
            v => v.ToString().ToLowerInvariant(),
            v => Enum.Parse<TEnum>(v, true));

    private static void ConfigureCurrency(Microsoft.EntityFrameworkCore.Metadata.Builders.PropertyBuilder<string> property) =>
        property.HasMaxLength(3).IsFixedLength();
}
