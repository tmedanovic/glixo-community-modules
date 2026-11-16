using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Glixo.ExtensionSdk.Http;

namespace Glixo.Reference.IssueLookup;

public static class IssueLookup
{
    private const int MaxResponseBytes = 128 * 1024;
    private static readonly Regex IssueKeyPattern = new("\\A[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,8}\\z", RegexOptions.CultureInvariant);

    // docs:snippet-start issue-lookup-mcp:csharp
    public static string Handle(string requestJson, IBroker broker)
    {
        using var envelope = JsonDocument.Parse(requestJson);
        var root = envelope.RootElement;
        if (Text(root, "kind") != "tools" || Text(root, "contributionId") != "issue-lookup")
            throw new InvalidOperationException("guest_envelope_invalid");
        var input = GetObject(root, "input");
        var issueKey = Text(input, "issueKey");
        if (issueKey is null || !IssueKeyPattern.IsMatch(issueKey)) throw new InvalidOperationException("issue_key_invalid");
        var configuration = GetObject(root, "configuration");
        if (Text(configuration, "endpointName") != "issues") throw new InvalidOperationException("endpoint_name_must_be_issues");
        var context = GetObject(root, "context");
        var endpoint = ResolveEndpoint(context);

        using var requestBuffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(requestBuffer))
        {
            writer.WriteStartObject();
            writer.WriteString("jsonrpc", "2.0");
            writer.WriteNumber("id", 1);
            writer.WriteString("method", "tools/call");
            writer.WritePropertyName("params");
            writer.WriteStartObject();
            writer.WriteString("name", "issues.lookup");
            writer.WritePropertyName("arguments");
            writer.WriteStartObject();
            writer.WriteString("issueKey", issueKey);
            writer.WriteEndObject();
            writer.WritePropertyName("_meta");
            writer.WriteStartObject();
            writer.WriteString("io.modelcontextprotocol/protocolVersion", "2026-07-28");
            writer.WritePropertyName("io.modelcontextprotocol/clientInfo");
            writer.WriteStartObject();
            writer.WriteString("name", "glixo-issue-lookup");
            writer.WriteString("version", "0.1.0");
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteEndObject();
        }
        var body = requestBuffer.ToArray();
        var request = new BrokerRequest(
            endpoint.Url,
            "POST",
            [
                new Header("Accept", "application/json"),
                new Header("MCP-Protocol-Version", "2026-07-28"),
                new Header("Mcp-Method", "tools/call"),
                new Header("Mcp-Name", "issues.lookup")
            ],
            body, "application/json", 15_000, MaxResponseBytes, 200, 299,
            endpoint.Handle, null, null, null);

        var handle = broker.Start(request);
        var completed = false;
        try
        {
            if (broker.Status(handle) != 200) throw new InvalidOperationException("mcp_http_status_invalid");
            var contentType = broker.ResponseHeaders(handle).FirstOrDefault(header =>
                string.Equals(header.Name, "content-type", StringComparison.OrdinalIgnoreCase))?.Value;
            if (contentType is null || !string.Equals(contentType.Split(';', 2)[0].Trim(), "application/json", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("mcp_content_type_invalid");
            using var response = new MemoryStream();
            var emptyReads = 0;
            while (true)
            {
                var chunk = broker.Read(handle, 16 * 1024);
                if (chunk is null) break;
                if (chunk.Length == 0 && ++emptyReads > 32) throw new InvalidOperationException("mcp_response_stalled");
                if (chunk.Length > 0) emptyReads = 0;
                if (response.Length + chunk.Length > MaxResponseBytes) throw new InvalidOperationException("mcp_response_too_large");
                response.Write(chunk);
            }
            using var document = JsonDocument.Parse(response.ToArray());
            var rpc = document.RootElement;
            if (Text(rpc, "jsonrpc") != "2.0" || !rpc.TryGetProperty("id", out var id) || id.GetInt32() != 1 ||
                rpc.TryGetProperty("error", out _)) throw new InvalidOperationException("mcp_call_failed");
            if (!rpc.TryGetProperty("result", out var result) || !result.TryGetProperty("content", out var content) ||
                content.ValueKind != JsonValueKind.Array || content.GetArrayLength() != 1)
                throw new InvalidOperationException("mcp_result_content_missing");
            var item = content[0];
            var summary = Text(item, "text");
            if (Text(item, "type") != "text" || summary is null || Encoding.UTF8.GetByteCount(summary) > 64 * 1024)
                throw new InvalidOperationException("mcp_result_content_invalid");
            completed = true;
            using var resultBuffer = new MemoryStream();
            using (var writer = new Utf8JsonWriter(resultBuffer))
            {
                writer.WriteStartObject();
                writer.WriteString("issueKey", issueKey);
                writer.WriteString("summary", summary);
                writer.WriteEndObject();
            }
            return Encoding.UTF8.GetString(resultBuffer.ToArray());
        }
        finally
        {
            if (!completed) broker.Cancel(handle);
            broker.Drop(handle);
        }
    }

    // docs:snippet-end issue-lookup-mcp:csharp

    private static (string Url, string Handle) ResolveEndpoint(JsonElement context)
    {
        if (!context.TryGetProperty("endpoints", out var endpoints) || endpoints.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException("approved_issues_endpoint_missing");
        foreach (var endpoint in endpoints.EnumerateArray())
        {
            if (Text(endpoint, "name") != "issues") continue;
            var handle = Text(endpoint, "handle");
            var baseUrl = Text(endpoint, "baseUrl");
            if (string.IsNullOrEmpty(handle) || !Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri) ||
                (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) ||
                !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
                throw new InvalidOperationException("approved_endpoint_url_invalid");
            return (new Uri(uri, "/mcp").ToString(), handle);
        }
        throw new InvalidOperationException("approved_issues_endpoint_missing");
    }

    private static JsonElement GetObject(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object && parent.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object
            ? value : throw new InvalidOperationException("guest_envelope_invalid");

    private static string? Text(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object && parent.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() : null;

}
