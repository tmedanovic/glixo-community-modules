namespace Glixo.ExtensionSdk.Llm;

public sealed record ToolCallDetails(string Id, string Name, string? ArgumentsFragment, bool Complete);
public sealed record Usage(uint InputTokens, uint OutputTokens, uint? CachedTokens, uint? ReasoningTokens, uint? TotalTokens);

public sealed record ProviderEvent(
    string RequestId,
    object? Part,
    Usage? Usage,
    string? Finish,
    string? ErrorCode,
    string? ErrorMessage,
    bool? Retryable,
    uint? RetryAfterMs,
    string? ProviderRequestId,
    string? ProviderResponseId);
