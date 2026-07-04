using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PricePilot.Application;
using PricePilot.Infrastructure.Services;

namespace PricePilot.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, string connectionString)
    {
        services.AddDbContext<AppDbContext>(options => options
            .UseNpgsql(connectionString)
            .UseSnakeCaseNamingConvention());

        services.AddScoped<IPropertyService, PropertyService>();
        services.AddScoped<IRecommendationQueries, RecommendationQueries>();
        services.AddScoped<IJobDispatcher, JobDispatcher>();
        services.AddScoped<IEventQueries, EventQueries>();

        return services;
    }
}
