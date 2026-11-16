using System.Buffers;
using System.Text;
using System.Text.Json;

namespace Glixo.ExtensionSdk.Workspace;

/// <summary>Validates bounded host workspace responses without reflection-dependent JSON serialization.</summary>
public static class WorkspacePayloads
{
    public sealed record FileItem(string Path, long Bytes);
    public const long MaximumJsonInteger = 9_007_199_254_740_991;
    public static string WorkspaceHandle(JsonElement request)
    {
        if (!request.TryGetProperty("context", out var context)
            || !context.TryGetProperty("resourceHandles", out var handles)
            || !handles.TryGetProperty("workspace", out var value)
            || value.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(value.GetString()))
            throw new InvalidOperationException("workspace_handle_missing");
        return value.GetString()!;
    }

    public static int OptionalInteger(JsonElement input, string name, int fallback, int minimum, int maximum)
    {
        if (!input.TryGetProperty(name, out var value)) return fallback;
        if (!value.TryGetInt32(out var number) || number < minimum || number > maximum)
            throw new InvalidOperationException("input_limit_invalid");
        return number;
    }

    public static (FileItem[] Items, bool Truncated) ReadInventory(string json, int limit)
    {
        using var inventory = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8 });
        var root = inventory.RootElement;
        if (!root.TryGetProperty("items", out var rows) || rows.ValueKind != JsonValueKind.Array
            || rows.GetArrayLength() > limit || !root.TryGetProperty("truncated", out var truncated)
            || truncated.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            throw new InvalidOperationException("workspace_search_result_invalid");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var items = rows.EnumerateArray().Select(row =>
        {
            var path = row.GetProperty("path").GetString();
            if (string.IsNullOrEmpty(path) || path.StartsWith('/') || path.Contains('\\') || path.Contains(':')
                || path.Split('/').Any(part => part is "" or "." or "..") || !seen.Add(path)
                || !row.GetProperty("bytes").TryGetInt64(out var bytes) || bytes < 0 || bytes > MaximumJsonInteger)
                throw new InvalidOperationException("workspace_search_item_invalid");
            return new FileItem(path, bytes);
        }).OrderBy(item => item.Path, Utf8Comparer.Instance).ToArray();
        return (items, truncated.GetBoolean());
    }

    public static string WriteJson(Action<Utf8JsonWriter> write)
    {
        var bytes = new ArrayBufferWriter<byte>();
        using var writer = new Utf8JsonWriter(bytes);
        write(writer); writer.Flush();
        return Encoding.UTF8.GetString(bytes.WrittenSpan);
    }

    public sealed class Utf8Comparer : IComparer<string>
    {
        public static Utf8Comparer Instance { get; } = new();
        public int Compare(string? left, string? right) =>
            Encoding.UTF8.GetBytes(left ?? "").AsSpan().SequenceCompareTo(Encoding.UTF8.GetBytes(right ?? ""));
    }
}
