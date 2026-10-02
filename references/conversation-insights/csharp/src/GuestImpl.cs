using System.Text.Json;
using System.Text.Json.Serialization;

namespace ContributionWorld.wit.Exports.glixo.contribution.v1_0_0;

public static class GuestExportsImpl
{
    public static string Invoke(string requestJson)
    {
        using var envelope = JsonDocument.Parse(requestJson);
        var root = envelope.RootElement;
        if (Text(root, "kind") != "messageMiddleware" || Text(root, "contributionId") != "conversation-insights")
            throw new InvalidOperationException("guest_envelope_invalid");
        return Analyze(root.GetProperty("input"));
    }

    // docs:snippet-start conversation-insights-handler:csharp
    internal static string Analyze(JsonElement input)
    {
        if (Number(input, "schemaVersion") != 1)
            throw new InvalidOperationException("middleware_schema_unsupported");
        var operation = Text(input, "operation");
        if (operation == "committed")
        {
            if (!input.TryGetProperty("committedMessage", out var message) || message.ValueKind != JsonValueKind.Object)
                throw new InvalidOperationException("committed_message_missing");
            var role = Text(message, "role");
            var observation = new CommittedObservation(
                1, 1, role == "user" ? 1 : 0, role == "assistant" ? 1 : 0,
                Count(message, "toolCallCount"), Count(message, "toolResultCount"), Count(message, "attachmentCount"));
            return JsonSerializer.Serialize(new CommittedResult(observation, "insights-recorded"), GuestJsonContext.Default.CommittedResult);
        }

        if (operation == "completed")
        {
            if (!input.TryGetProperty("completion", out var completion) || completion.ValueKind != JsonValueKind.Object)
                throw new InvalidOperationException("completion_missing");
            var hasUsage = completion.TryGetProperty("actualUsage", out var usage) && usage.ValueKind == JsonValueKind.Object;
            var actualUsage = hasUsage ? new UsageSnapshot(
                NullableCount(usage, "inputTokens"), NullableCount(usage, "outputTokens"),
                NullableCount(usage, "cachedTokens"), NullableCount(usage, "reasoningTokens"), NullableCount(usage, "totalTokens")) : null;
            var observation = new CompletedObservation(
                1, Count(completion, "latencyMilliseconds"), Count(completion, "userMessageCount"),
                Count(completion, "assistantMessageCount"), Count(completion, "toolCallCount"),
                Count(completion, "toolResultCount"), Count(completion, "attachmentCount"), hasUsage, actualUsage,
                Count(completion, "estimatedInputCharacters"), Count(completion, "estimatedOutputCharacters"), true);
            return JsonSerializer.Serialize(new CompletedResult(observation, "analysis-complete"), GuestJsonContext.Default.CompletedResult);
        }
        throw new InvalidOperationException("operation_unsupported");
    }
    // docs:snippet-end conversation-insights-handler:csharp

    private static long Count(JsonElement value, string property) => NullableCount(value, property) ?? 0;
    private static long? NullableCount(JsonElement value, string property) =>
        value.TryGetProperty(property, out var item) && item.TryGetInt64(out var count) && count >= 0 ? count : null;
    private static long Number(JsonElement value, string property) => NullableCount(value, property) ?? -1;
    private static string? Text(JsonElement value, string property) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(property, out var item)
            && item.ValueKind == JsonValueKind.String ? item.GetString() : null;
}

internal sealed record UsageSnapshot(long? InputTokens, long? OutputTokens, long? CachedTokens, long? ReasoningTokens, long? TotalTokens);
internal sealed record CommittedObservation(int SchemaVersion, int MessageCount, int UserMessageCount, int AssistantMessageCount,
    long ToolCallCount, long ToolResultCount, long AttachmentCount);
internal sealed record CompletedObservation(int SchemaVersion, long LatencyMilliseconds, long UserMessageCount,
    long AssistantMessageCount, long ToolCallCount, long ToolResultCount, long AttachmentCount,
    bool ActualUsageAvailable, UsageSnapshot? ActualUsage, long EstimatedInputCharacters, long EstimatedOutputCharacters,
    bool TextStatisticsAreEstimates);
internal sealed record CommittedResult(CommittedObservation Observation, string AuditDescription);
internal sealed record CompletedResult(CompletedObservation Observation, string AuditDescription);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(CommittedResult))]
[JsonSerializable(typeof(CompletedResult))]
internal partial class GuestJsonContext : JsonSerializerContext { }
