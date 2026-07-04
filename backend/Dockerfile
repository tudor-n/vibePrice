# Multi-stage build: SDK image compiles, slim ASP.NET runtime image serves on :8080.
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Restore first for layer caching.
COPY PricePilot.sln Directory.Build.props ./
COPY .config/ .config/
COPY src/PricePilot.Domain/PricePilot.Domain.csproj src/PricePilot.Domain/
COPY src/PricePilot.Application/PricePilot.Application.csproj src/PricePilot.Application/
COPY src/PricePilot.Infrastructure/PricePilot.Infrastructure.csproj src/PricePilot.Infrastructure/
COPY src/PricePilot.Connectors/PricePilot.Connectors.csproj src/PricePilot.Connectors/
COPY src/PricePilot.Api/PricePilot.Api.csproj src/PricePilot.Api/
RUN dotnet restore src/PricePilot.Api/PricePilot.Api.csproj

COPY src/ src/
RUN dotnet publish src/PricePilot.Api/PricePilot.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "PricePilot.Api.dll"]
