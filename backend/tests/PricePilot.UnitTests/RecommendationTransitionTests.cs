using PricePilot.Domain;
using Xunit;

namespace PricePilot.UnitTests;

public class RecommendationTransitionTests
{
    private static Recommendation NewRecommendation(RecommendationStatus status = RecommendationStatus.Pending) =>
        new()
        {
            Id = Guid.NewGuid(),
            TenantId = Guid.NewGuid(),
            PropertyId = Guid.NewGuid(),
            RoomTypeId = Guid.NewGuid(),
            StayDate = new DateOnly(2026, 6, 15),
            CurrentPrice = 350m,
            RecommendedPrice = 420m,
            Currency = "RON",
            ExpectedImpact = 3400m,
            Factors = """{"rules":[]}""",
            Status = status,
            CreatedAt = DateTimeOffset.UtcNow,
        };

    [Theory]
    [InlineData(RecommendationStatus.Accepted)]
    [InlineData(RecommendationStatus.Dismissed)]
    public void Pending_can_be_decided(RecommendationStatus decision)
    {
        var recommendation = NewRecommendation();
        var decidedAt = DateTimeOffset.UtcNow;

        var ok = recommendation.TryTransitionTo(decision, decidedAt);

        Assert.True(ok);
        Assert.Equal(decision, recommendation.Status);
        Assert.Equal(decidedAt, recommendation.DecidedAt);
    }

    [Fact]
    public void Accepted_cannot_become_dismissed()
    {
        var recommendation = NewRecommendation(RecommendationStatus.Accepted);

        var ok = recommendation.TryTransitionTo(RecommendationStatus.Dismissed, DateTimeOffset.UtcNow);

        Assert.False(ok);
        Assert.Equal(RecommendationStatus.Accepted, recommendation.Status);
        Assert.Null(recommendation.DecidedAt);
    }

    [Fact]
    public void Dismissed_cannot_become_accepted()
    {
        var recommendation = NewRecommendation(RecommendationStatus.Dismissed);

        var ok = recommendation.TryTransitionTo(RecommendationStatus.Accepted, DateTimeOffset.UtcNow);

        Assert.False(ok);
        Assert.Equal(RecommendationStatus.Dismissed, recommendation.Status);
    }

    [Fact]
    public void Pending_cannot_transition_to_pending()
    {
        var recommendation = NewRecommendation();

        var ok = recommendation.TryTransitionTo(RecommendationStatus.Pending, DateTimeOffset.UtcNow);

        Assert.False(ok);
        Assert.Equal(RecommendationStatus.Pending, recommendation.Status);
    }

    [Fact]
    public void CanTransitionTo_matches_TryTransitionTo()
    {
        Assert.True(NewRecommendation().CanTransitionTo(RecommendationStatus.Accepted));
        Assert.True(NewRecommendation().CanTransitionTo(RecommendationStatus.Dismissed));
        Assert.False(NewRecommendation(RecommendationStatus.Accepted).CanTransitionTo(RecommendationStatus.Dismissed));
        Assert.False(NewRecommendation().CanTransitionTo(RecommendationStatus.Pending));
    }
}
