using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ContributionWorld.wit.Exports.glixo.contribution.v1_0_0;

public static class GuestExportsImpl
{
    public static string Invoke(string requestJson)
    {
        using var envelope = JsonDocument.Parse(requestJson);
        var root = envelope.RootElement;
        if (Text(root, "kind") != "messageMiddleware" || Text(root, "contributionId") != "prompt-redactor")
            throw new InvalidOperationException("guest_envelope_invalid");
        var configuration = root.TryGetProperty("configuration", out var config) ? config : default;
        return JsonSerializer.Serialize(Redact(root.GetProperty("input"), configuration), GuestJsonContext.Default.RedactorResponse);
    }

    private sealed record Rule(string Match, string Replacement);

    private static IReadOnlyList<Rule> ReadRules(JsonElement configuration)
    {
        if (configuration.ValueKind != JsonValueKind.Object || !configuration.TryGetProperty("rules", out var source))
            throw new InvalidOperationException("redaction_rules_invalid");
        if (source.ValueKind != JsonValueKind.Array || source.GetArrayLength() > 64)
            throw new InvalidOperationException("redaction_rules_invalid");
        var rules = new List<Rule>();
        foreach (var item in source.EnumerateArray())
        {
            var match = Text(item, "match");
            var replacement = Text(item, "replacement");
            if (string.IsNullOrEmpty(match) || match.EnumerateRunes().Count() > 512
                || replacement is null || replacement.EnumerateRunes().Count() > 1024)
                throw new InvalidOperationException("redaction_rule_invalid");
            rules.Add(new Rule(match, replacement));
        }
        return rules;
    }

    // docs:snippet-start prompt-redactor-handler:csharp
    public static string PreviewText(string text, IReadOnlyList<(string Match, string Replacement)> rules)
    {
        ArgumentNullException.ThrowIfNull(text);
        if (rules.Count > 64) throw new InvalidOperationException("redaction_rules_invalid");
        foreach (var (match, replacement) in rules)
        {
            if (string.IsNullOrEmpty(match) || match.EnumerateRunes().Count() > 512 || replacement.EnumerateRunes().Count() > 1024)
                throw new InvalidOperationException("redaction_rule_invalid");
            text = text.Replace(match, replacement, StringComparison.Ordinal);
        }
        return text;
    }

    internal static RedactorResponse Redact(JsonElement input, JsonElement configuration)
    {
        if (Number(input, "schemaVersion") != 1 || Text(input, "operation") != "before-provider")
            throw new InvalidOperationException("operation_unsupported");
        if (!input.TryGetProperty("conversation", out var conversation)
            || !conversation.TryGetProperty("messages", out var messages) || messages.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException("conversation_missing");
        var rules = ReadRules(configuration);
        var patches = new List<TextPatch>();
        foreach (var message in messages.EnumerateArray())
        {
            if (Text(message, "role") != "user" || !message.TryGetProperty("isHostAuthority", out var authority)
                || authority.ValueKind != JsonValueKind.False || Text(message, "id") is not { } messageId
                || !message.TryGetProperty("parts", out var parts) || parts.ValueKind != JsonValueKind.Array)
                continue;
            foreach (var part in parts.EnumerateArray())
            {
                if (Text(part, "kind") != "text" || Text(part, "id") is not { } partId || Text(part, "text") is not { } original)
                    continue;
                var changed = PreviewText(original, rules.Select(rule => (rule.Match, rule.Replacement)).ToArray());
                if (!string.Equals(changed, original, StringComparison.Ordinal))
                    patches.Add(new TextPatch(messageId, partId, changed));
            }
        }
        return new RedactorResponse(patches, patches.Count == 0 ? "no-change" : "redaction-applied");
    }
    // docs:snippet-end prompt-redactor-handler:csharp

    private static long Number(JsonElement value, string property) =>
        value.TryGetProperty(property, out var item) && item.TryGetInt64(out var number) ? number : -1;
    private static string? Text(JsonElement value, string property) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(property, out var item)
            && item.ValueKind == JsonValueKind.String ? item.GetString() : null;
}

internal sealed record TextPatch(string MessageId, string PartId, string Text);
internal sealed record RedactorResponse(IReadOnlyList<TextPatch> TextPatches, string AuditDescription);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(RedactorResponse))]
internal partial class GuestJsonContext : JsonSerializerContext { }
