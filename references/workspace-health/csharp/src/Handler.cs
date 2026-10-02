using System.Text.Json;
using Glixo.ExtensionSdk.Workspace;
using static Glixo.ExtensionSdk.Workspace.WorkspacePayloads;

namespace Glixo.Reference.WorkspaceHealth;

public static class Handler
{

    // docs:snippet-start workspace-health-handler:csharp
    public static string Invoke(string requestJson, IWorkspaceReader workspace)
    {
        using var request = JsonDocument.Parse(requestJson, new JsonDocumentOptions { MaxDepth = 32 });
        var root = request.RootElement;
        if (root.GetProperty("kind").GetString() != "tools" || root.GetProperty("contributionId").GetString() != "inspect")
            throw new InvalidOperationException("contribution_mismatch");
        var handle = WorkspaceHandle(root);
        var limit = OptionalInteger(root.GetProperty("input"), "maxFiles", 100, 1, 100);
        var (items, truncated) = ReadInventory(workspace.Search(handle, "", (uint)limit), limit);
        var total = items.Aggregate(0L, (sum, item) => checked(sum + item.Bytes));
        if (total > MaximumJsonInteger) throw new InvalidOperationException("workspace_search_result_invalid");
        var extensions = new SortedDictionary<string, int>(Utf8Comparer.Instance);
        foreach (var item in items)
        {
            var name = item.Path[(item.Path.LastIndexOf('/') + 1)..];
            var dot = name.LastIndexOf('.');
            var extension = dot <= 0 ? "[none]" : name[dot..].ToLowerInvariant();
            extensions[extension] = extensions.GetValueOrDefault(extension) + 1;
        }
        return WriteJson(writer =>
        {
            writer.WriteStartObject();
            writer.WriteNumber("sampledFiles", items.Length);
            writer.WriteNumber("sampledBytes", total);
            writer.WriteBoolean("truncated", truncated);
            writer.WritePropertyName("eligibleFileTotals");
            if (truncated) writer.WriteNullValue();
            else
            {
                writer.WriteStartObject(); writer.WriteNumber("fileCount", items.Length);
                writer.WriteNumber("bytes", total); writer.WriteEndObject();
            }
            writer.WriteStartObject("sampledExtensions");
            foreach (var (extension, count) in extensions) writer.WriteNumber(extension, count);
            writer.WriteEndObject();
            writer.WriteStartArray("largestFiles");
            foreach (var item in items.OrderByDescending(item => item.Bytes)
                .ThenBy(item => item.Path, Utf8Comparer.Instance).Take(10))
            {
                writer.WriteStartObject(); writer.WriteString("path", item.Path);
                writer.WriteNumber("bytes", item.Bytes); writer.WriteEndObject();
            }
            writer.WriteEndArray(); writer.WriteEndObject();
        });
    }
    // docs:snippet-end workspace-health-handler:csharp

}
