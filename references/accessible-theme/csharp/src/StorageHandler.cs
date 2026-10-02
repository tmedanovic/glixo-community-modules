using System.Text.Json;
using System.Text.RegularExpressions;
using Glixo.ExtensionSdk.State;

namespace Glixo.AccessibleTheme;

public static class PreferenceAction
{
    private const string ActionId = "save-preferences";
    private const string StorageKey = "accessible-theme/preferences/current";
    private static readonly Regex AccentPattern = new("^#[0-9a-fA-F]{6}$", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static JsonElement Handle(string requestJson, IScopedState state)
    {
        if (System.Text.Encoding.UTF8.GetByteCount(requestJson) > 32 * 1024) throw new InvalidOperationException("action_payload_too_large");
        using var document = JsonDocument.Parse(requestJson, new JsonDocumentOptions { MaxDepth = 16 });
        var envelope = document.RootElement;
        if (ReadString(envelope, "kind") != "actions" || ReadString(envelope, "contributionId") != ActionId)
            throw new InvalidOperationException("contribution_mismatch");
        if (!envelope.TryGetProperty("context", out var context) || string.IsNullOrWhiteSpace(ReadString(context, "sessionId")))
            throw new InvalidOperationException("session_context_missing");
        if (!envelope.TryGetProperty("input", out var input) || input.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException("input_object_required");
        var fields = input.EnumerateObject().ToArray();
        if (fields.Length != 2 || fields.Any(field => field.Name is not ("accent" or "largeControls")))
            throw new InvalidOperationException("preferences_invalid");
        var accent = ReadString(input, "accent");
        if (accent is null || !AccentPattern.IsMatch(accent)) throw new InvalidOperationException("accent_invalid");
        if (!input.TryGetProperty("largeControls", out var large) || large.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            throw new InvalidOperationException("large_controls_invalid");
        var value = $"{{\"accent\":\"{accent.ToLowerInvariant()}\",\"largeControls\":{large.GetBoolean().ToString().ToLowerInvariant()}}}";
        state.Set(StorageKey, value);
        using var result = JsonDocument.Parse("{\"accepted\":true}");
        return result.RootElement.Clone();
    }

    private static string? ReadString(JsonElement value, string name) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var field) && field.ValueKind == JsonValueKind.String
            ? field.GetString() : null;
}
