using System.Text.Json;
using System.Text.Json.Serialization;

namespace Glixo.ExtensionSdk;

/// <summary>Direct host-stamped contribution invoke JSON object.</summary>
public sealed record GuestEnvelope<TConfiguration>(
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("contributionId")] string ContributionId,
    [property: JsonPropertyName("configuration")] TConfiguration Configuration,
    [property: JsonPropertyName("input")] JsonElement Input,
    [property: JsonPropertyName("context")] GuestContext Context);

public sealed record GuestContext(
    [property: JsonPropertyName("sessionId")] string SessionId,
    [property: JsonPropertyName("resourceHandles")] IReadOnlyDictionary<string, string> ResourceHandles,
    [property: JsonPropertyName("endpoints")] IReadOnlyList<EndpointGrant> Endpoints);

public sealed record EndpointGrant(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("handle")] string Handle,
    [property: JsonPropertyName("baseUrl")] string BaseUrl);
public sealed record GuestReply<TResponse>([property: JsonPropertyName("response")] TResponse Response);
