using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Glixo.ExtensionSdk.State;

namespace Glixo.WorkspaceStorage;

public static class StorageHandler
{
    public const string ContributionId = "storage";
    public const string TestPrefix = "workspace-storage/test/";
    public const int MaxValueBytes = 4096;
    // docs:snippet-start workspace-storage-handler:csharp
    public static JsonElement Handle(string requestJson, IScopedState state)
    {
        using var document = JsonDocument.Parse(requestJson);
        var envelope = document.RootElement;
        if (envelope.ValueKind != JsonValueKind.Object
            || ReadString(envelope, "kind") != "tools"
            || ReadString(envelope, "contributionId") != ContributionId)
            throw new InvalidOperationException("contribution_mismatch");
        if (!envelope.TryGetProperty("input", out var input) || input.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException("input_object_required");
        var operation = ReadString(input, "operation") ?? throw new InvalidOperationException("storage_operation_invalid");
        JsonElement response;
        switch (operation)
        {
            case "get":
            {
                EnsureFields(input, "operation", "key");
                var key = ReadKey(input, "key");
                response = JsonSerializer.SerializeToElement(new GetResponse(operation, key, state.Get(key)), StorageJsonContext.Default.GetResponse);
                break;
            }
            case "set":
            {
                EnsureFields(input, "operation", "key", "value");
                var key = ReadKey(input, "key");
                var value = ReadString(input, "value") ?? throw new InvalidOperationException("value_string_required");
                if (Encoding.UTF8.GetByteCount(value) > MaxValueBytes) throw new InvalidOperationException("value_too_large");
                state.Set(key, value);
                response = JsonSerializer.SerializeToElement(new SetResponse(operation, key, true), StorageJsonContext.Default.SetResponse);
                break;
            }
            case "list":
            {
                EnsureFields(input, "operation", "prefix");
                if (input.TryGetProperty("prefix", out var prefixElement) && prefixElement.ValueKind != JsonValueKind.String)
                    throw new InvalidOperationException("key_prefix_invalid");
                var prefix = ReadString(input, "prefix") ?? "";
                if (prefix.Length > 0 && !ValidKey(prefix)) throw new InvalidOperationException("key_prefix_invalid");
                var fullPrefix = prefix.Length == 0 ? TestPrefix : StorageKey(prefix);
                var keys = state.List(fullPrefix)
                    .Where(key => key.StartsWith(TestPrefix, StringComparison.Ordinal))
                    .Select(key => key[TestPrefix.Length..])
                    .Where(key => ValidKey(key) && key.StartsWith(prefix, StringComparison.Ordinal))
                    .OrderBy(key => key, StringComparer.Ordinal)
                    .Take(100)
                    .ToArray();
                response = JsonSerializer.SerializeToElement(new ListResponse(operation, prefix, keys), StorageJsonContext.Default.ListResponse);
                break;
            }
            case "delete":
            {
                EnsureFields(input, "operation", "key");
                var key = ReadKey(input, "key");
                response = JsonSerializer.SerializeToElement(new DeleteResponse(operation, key, state.Delete(key)), StorageJsonContext.Default.DeleteResponse);
                break;
            }
            default: throw new InvalidOperationException("storage_operation_invalid");
        }
        return response;
    }
    // docs:snippet-end workspace-storage-handler:csharp

    private static string? ReadString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static string ReadKey(JsonElement input, string name) =>
        StorageKey(ReadString(input, name) ?? throw new InvalidOperationException("storage_key_invalid"));
    private static string StorageKey(string value)
    {
        if (!ValidKey(value)) throw new InvalidOperationException("storage_key_invalid");
        return TestPrefix + value;
    }
    private static bool ValidKey(string value) => value.Length is > 0 and <= 64
        && (IsLower(value[0]) || IsDigit(value[0]))
        && value.Skip(1).All(character => IsLower(character) || IsDigit(character) || character is '.' or '_' or '-');
    private static bool IsLower(char value) => value is >= 'a' and <= 'z';
    private static bool IsDigit(char value) => value is >= '0' and <= '9';
    private static void EnsureFields(JsonElement input, params string[] allowed)
    {
        var accepted = new HashSet<string>(allowed, StringComparer.Ordinal);
        foreach (var property in input.EnumerateObject())
            if (!accepted.Contains(property.Name)) throw new InvalidOperationException("storage_input_invalid");
    }
}

internal sealed record GetResponse(string Operation, string Key, string? Value);
internal sealed record SetResponse(string Operation, string Key, bool Stored);
internal sealed record ListResponse(string Operation, string Prefix, IReadOnlyList<string> Keys);
internal sealed record DeleteResponse(string Operation, string Key, bool Deleted);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(GetResponse))]
[JsonSerializable(typeof(SetResponse))]
[JsonSerializable(typeof(ListResponse))]
[JsonSerializable(typeof(DeleteResponse))]
internal partial class StorageJsonContext : JsonSerializerContext { }
