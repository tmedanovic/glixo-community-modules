using System.Text;
using System.Text.Json;
using Glixo.ExtensionSdk.Workspace;
using Inventory = Glixo.ExtensionSdk.Workspace.WorkspacePayloads;

namespace Glixo.Reference.DocumentIndex;

public static class Handler
{
    static readonly UTF8Encoding StrictUtf8 = new(false, true);

    // docs:snippet-start document-index-handler:csharp
    public static string Invoke(string requestJson, IWorkspaceReader workspace)
    {
        using var request = JsonDocument.Parse(requestJson, new JsonDocumentOptions { MaxDepth = 32 });
        var root = request.RootElement;
        if (root.GetProperty("kind").GetString() != "dataSources"
            || root.GetProperty("contributionId").GetString() != "search")
            throw new InvalidOperationException("contribution_mismatch");
        var handle = Inventory.WorkspaceHandle(root);
        var input = root.GetProperty("input");
        var query = input.GetProperty("query").GetString();
        if (string.IsNullOrWhiteSpace(query) || query.Length > 128) throw new InvalidOperationException("query_invalid");
        var limit = Inventory.OptionalInteger(input, "limit", 10, 1, 20);
        var excerptLimit = Inventory.OptionalInteger(input, "excerptBytes", 96, 1, 96);
        // Search matches paths, not contents. The host controls the workspace root and read bound.
        var (matches, truncated) = Inventory.ReadInventory(workspace.Search(handle, query, (uint)limit), limit);
        return Inventory.WriteJson(writer =>
        {
            writer.WriteStartObject(); writer.WriteString("query", query);
            writer.WriteStartArray("items");
            foreach (var item in matches)
            {
                writer.WriteStartObject(); writer.WriteString("path", item.Path); writer.WriteNumber("bytes", item.Bytes);
                if (item.Bytes > 4096)
                {
                    writer.WriteNull("excerpt"); writer.WriteBoolean("excerptTruncated", true);
                }
                else
                {
                    var text = workspace.Read(handle, item.Path, 4096);
                    var bytes = StrictUtf8.GetBytes(text);
                    if (bytes.Length > 4096) throw new InvalidOperationException("workspace_read_result_invalid");
                    var end = Math.Min(bytes.Length, excerptLimit);
                    while (end > 0)
                    {
                        try { StrictUtf8.GetString(bytes, 0, end); break; }
                        catch (DecoderFallbackException) { end--; }
                    }
                    writer.WriteString("excerpt", StrictUtf8.GetString(bytes, 0, end));
                    writer.WriteBoolean("excerptTruncated", bytes.Length > excerptLimit);
                }
                writer.WriteEndObject();
            }
            writer.WriteEndArray(); writer.WriteBoolean("truncated", truncated); writer.WriteEndObject();
        });
    }
    // docs:snippet-end document-index-handler:csharp
}
