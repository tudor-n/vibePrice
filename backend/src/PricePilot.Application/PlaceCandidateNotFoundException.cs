namespace PricePilot.Application;

/// <summary>Thrown by <see cref="IPropertyService.PickPlaceAsync"/> when the chosen placeId
/// isn't among the property's stored candidates. The endpoint maps this to 400.</summary>
public sealed class PlaceCandidateNotFoundException(string placeId)
    : Exception($"place_id '{placeId}' is not among the stored candidates");
