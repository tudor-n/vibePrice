using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PricePilot.Application;
using PricePilot.Domain;
using PricePilot.Infrastructure.Services;

namespace PricePilot.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, string connectionString)
    {
        services.AddDbContext<AppDbContext>(options => options
            .UseNpgsql(connectionString)
            .UseSnakeCaseNamingConvention());

        // PBKDF2 password hashing (Microsoft.Extensions.Identity.Core); no Identity stores.
        services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<DemoSeeder>(); // dev/demo only; invoked from Program.cs behind guards

        services.AddScoped<IPropertyService, PropertyService>();
        services.AddScoped<IRecommendationQueries, RecommendationQueries>();
        services.AddScoped<IJobDispatcher, JobDispatcher>();
        services.AddScoped<IEventQueries, EventQueries>();

        return services;
    }
}
