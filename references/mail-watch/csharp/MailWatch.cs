using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Glixo.ExtensionSdk.Http;
using Glixo.ExtensionSdk.State;

namespace Glixo.Reference.MailWatch;

public sealed record MailCheckpoint
{
    [JsonPropertyName("initialized")] public bool Initialized { get; init; }
    [JsonPropertyName("initializing")] public bool Initializing { get; init; }
    [JsonPropertyName("deltaUrl")] public string? DeltaUrl { get; init; }
    [JsonPropertyName("pendingUrl")] public string? PendingUrl { get; init; }
}

public sealed record MailServiceConfiguration
{
    [JsonPropertyName("maxPagesPerWake")] public int MaxPagesPerWake { get; init; } = 5;
}

public sealed record MailServiceInput
{
    [JsonPropertyName("operation")] public string Operation { get; init; } = "wake";
    [JsonPropertyName("checkpoint")] public MailCheckpoint? Checkpoint { get; init; }
}

public sealed record MailServiceContext
{
    [JsonPropertyName("resourceHandles")] public Dictionary<string, string>? ResourceHandles { get; init; }
}

public sealed record MailServiceRequest
{
    [JsonPropertyName("kind")] public string Kind { get; init; } = "";
    [JsonPropertyName("contributionId")] public string ContributionId { get; init; } = "";
    [JsonPropertyName("configuration")] public MailServiceConfiguration? Configuration { get; init; }
    [JsonPropertyName("input")] public MailServiceInput Input { get; init; } = new();
    [JsonPropertyName("context")] public MailServiceContext? Context { get; init; }
}

public sealed record MailEventPayload(
    [property: JsonPropertyName("messageId")] string MessageId,
    [property: JsonPropertyName("receivedAt")] string ReceivedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [property: JsonPropertyName("sender")] string? Sender);

public sealed record MailEvent(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("idempotencyKey")] string IdempotencyKey,
    [property: JsonPropertyName("payload")] MailEventPayload Payload);

public sealed record MailServiceResult(
    [property: JsonPropertyName("checkpoint")] MailCheckpoint Checkpoint,
    [property: JsonPropertyName("events")] IReadOnlyList<MailEvent> Events,
    [property: JsonPropertyName("health")] string Health);

public static class MailWatch
{
    public const string ReferenceId = "mail-watch";
    public const string ContributionId = "mail-watch";
    public const string EventType = "mail.received";
    const string GraphHost = "graph.microsoft.com";
    const string GraphPath = "/v1.0/me/mailFolders/inbox/messages/delta";
    const string InitialDeltaUrl = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,receivedDateTime,from&$top=10";
    const string OAuthHandleName = "oauth";
    const int MaxPagesPerWake = 5;
    const int MaxPageBytes = 1_000_000;

    /**
     * docs:snippet-start mail-watch-handler:csharp
     * A bounded wake reads only Inbox metadata through the host HTTP broker.
     * The handler never reads body content, sends mail, or follows a guest-selected host.
     */
    public static MailServiceResult Handle(MailServiceRequest request, IBroker broker, IScopedState state)
    {
        _ = state;
        if (request.Kind != "backgroundServices" || request.ContributionId != ContributionId)
            throw new InvalidOperationException("contribution_mismatch");
        var operation = request.Input.Operation;
        if (operation is not ("initialize" or "wake" or "health" or "stop"))
            throw new InvalidOperationException("service_operation_invalid");
        var checkpoint = request.Input.Checkpoint ?? new MailCheckpoint();
        if (operation is "health" or "stop") return Result(checkpoint, []);

        var handles = request.Context?.ResourceHandles;
        if (handles is null || !handles.TryGetValue(OAuthHandleName, out var oauthHandle) || string.IsNullOrWhiteSpace(oauthHandle))
            throw new InvalidOperationException("graph_oauth_lease_missing");

        var configuredPages = request.Configuration?.MaxPagesPerWake ?? MaxPagesPerWake;
        if (configuredPages is < 1 or > MaxPagesPerWake) throw new InvalidOperationException("mail_watch_page_limit_invalid");
        var initializing = operation == "initialize" || checkpoint.Initializing || !checkpoint.Initialized;
        var cursor = checkpoint.PendingUrl ?? checkpoint.DeltaUrl ?? InitialDeltaUrl;
        var deltaUrl = checkpoint.DeltaUrl;
        string? pendingUrl = null;
        var events = new List<MailEvent>();

        for (var page = 0; page < configuredPages; page++)
        {
            var document = ReadGraphJson(broker, new BrokerRequest(
                ValidateGraphDeltaUrl(cursor), "GET", [new Header("Accept", "application/json")], null, null,
                5000, MaxPageBytes, 200, 299, null, OAuthHandleName, "Authorization", "Bearer"));
            if (!document.RootElement.TryGetProperty("value", out var values) || values.ValueKind != JsonValueKind.Array)
                throw new InvalidOperationException("graph_delta_value_invalid");
            if (!initializing)
            {
                foreach (var item in values.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.Object && !item.TryGetProperty("@removed", out _))
                    {
                        var emitted = ToMailEvent(item);
                        if (emitted is not null) events.Add(emitted);
                    }
                }
            }

            if (document.RootElement.TryGetProperty("@odata.nextLink", out var next) && next.ValueKind == JsonValueKind.String)
            {
                cursor = ValidateGraphDeltaUrl(next.GetString()!);
                pendingUrl = next.GetString();
                continue;
            }
            if (!document.RootElement.TryGetProperty("@odata.deltaLink", out var finalDelta) || finalDelta.ValueKind != JsonValueKind.String)
                throw new InvalidOperationException("graph_delta_link_missing");
            deltaUrl = ValidateGraphDeltaUrl(finalDelta.GetString()!);
            pendingUrl = null;
            initializing = false;
            break;
        }

        if (pendingUrl is null && initializing) throw new InvalidOperationException("graph_initial_sync_incomplete");
        return Result(new MailCheckpoint
        {
            Initialized = !initializing,
            Initializing = initializing,
            DeltaUrl = deltaUrl,
            PendingUrl = pendingUrl,
        }, events);
    }
    /** docs:snippet-end mail-watch-handler:csharp */

    public static string ValidateGraphDeltaUrl(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || !string.Equals(uri.Host, GraphHost, StringComparison.OrdinalIgnoreCase)
            || (uri.Port != 443)
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !string.IsNullOrEmpty(uri.Fragment)
            || !string.Equals(uri.AbsolutePath, GraphPath, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("graph_delta_url_outside_scope");
        return value;
    }

    static JsonDocument ReadGraphJson(IBroker broker, BrokerRequest request)
    {
        var handle = broker.Start(request);
        var complete = false;
        try
        {
            var status = broker.Status(handle);
            if (status is < 200 or > 299) throw new InvalidOperationException("graph_http_status_rejected");
            using var body = new MemoryStream();
            while (true)
            {
                var chunk = broker.Read(handle, 16 * 1024);
                if (chunk is null) break;
                if (body.Length + chunk.Length > MaxPageBytes) throw new InvalidOperationException("graph_response_too_large");
                body.Write(chunk);
            }
            var parsed = JsonDocument.Parse(body.ToArray());
            if (parsed.RootElement.ValueKind != JsonValueKind.Object)
            {
                parsed.Dispose();
                throw new InvalidOperationException("graph_response_invalid");
            }
            complete = true;
            return parsed;
        }
        finally
        {
            if (!complete) broker.Cancel(handle);
            broker.Drop(handle);
        }
    }

    static MailEvent? ToMailEvent(JsonElement item)
    {
        if (!item.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String || string.IsNullOrEmpty(id.GetString())
            || !item.TryGetProperty("receivedDateTime", out var received) || received.ValueKind != JsonValueKind.String || string.IsNullOrEmpty(received.GetString()))
            return null;
        string? sender = null;
        if (item.TryGetProperty("from", out var from) && from.ValueKind == JsonValueKind.Object
            && from.TryGetProperty("emailAddress", out var email) && email.ValueKind == JsonValueKind.Object
            && email.TryGetProperty("address", out var address) && address.ValueKind == JsonValueKind.String)
            sender = address.GetString()![..Math.Min(address.GetString()!.Length, 320)];
        return new MailEvent(EventType, "mail:" + StableId(id.GetString()!), new MailEventPayload(id.GetString()!, received.GetString()!, sender));
    }

    static string StableId(string value)
    {
        const ulong offset = 0xcbf29ce484222325;
        const ulong prime = 0x100000001b3;
        var hash = offset;
        foreach (var item in Encoding.UTF8.GetBytes(value)) hash = unchecked((hash ^ item) * prime);
        return hash.ToString("x16", CultureInfo.InvariantCulture);
    }

    static MailServiceResult Result(MailCheckpoint checkpoint, IReadOnlyList<MailEvent> events) => new(checkpoint, events, "healthy");
}
