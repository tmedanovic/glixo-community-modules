using System.Collections;
using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Glixo.ExtensionSdk.Http;
using H = ProviderCompatWorld.wit.Imports.glixo.http.v3_0_0.ITypesImports;
using L = ProviderCompatWorld.wit.Imports.glixo.llmTypes.v3_0_0.ITypesImports;
using ProviderCompatWorld.wit.Imports.glixo.http.v3_0_0;

namespace ProviderCompatWorld.wit.Exports.glixo.llmProviderCompat.v3_0_0;

public static class ProviderExportsImpl
{
    private sealed class HostBroker : IBroker
    {
        public uint Start(BrokerRequest request) => IBrokerImports.HttpStart(new H.HttpRequest(
            request.Url, request.Method,
            request.Headers.Select(h => new H.Header(h.Name, h.Value)).ToList(),
            request.Body, request.ContentType, request.TimeoutMs, request.MaxResponseBytes,
            request.AcceptedStatusMin, request.AcceptedStatusMax, request.EndpointHandle,
            request.SecretHandle, request.AuthHeader, request.AuthScheme));
        public ushort Status(uint handle) => IBrokerImports.HttpStatus(handle);
        public IReadOnlyList<Header> ResponseHeaders(uint handle) => IBrokerImports.HttpResponseHeaders(handle)
            .Select(h => new Header(h.name, h.value)).ToArray();
        public byte[]? Read(uint handle, uint maxBytes) => IBrokerImports.HttpRead(handle, maxBytes);
        public void Cancel(uint handle) => IBrokerImports.HttpCancel(handle);
        public void Drop(uint handle) => IBrokerImports.HttpDrop(handle);
    }

    private sealed class Session(NdjsonStream stream, string requestId)
    {
        public NdjsonStream Stream { get; } = stream;
        public string RequestId { get; } = requestId;
        public bool Done { get; set; }
        public bool TerminalSent { get; set; }
        public bool Cancelled { get; set; }
        public int ToolIndex { get; set; }
    }

    private static readonly ConcurrentDictionary<uint, Session> Sessions = new();
    private static int _nextHandle;

    private static byte[] SerializeJson(object? value)
    {
        using var output = new MemoryStream();
        using (var writer = new Utf8JsonWriter(output)) WriteJsonValue(writer, value);
        return output.ToArray();
    }

    private static void WriteJsonValue(Utf8JsonWriter writer, object? value)
    {
        switch (value)
        {
            case null: writer.WriteNullValue(); return;
            case string text: writer.WriteStringValue(text); return;
            case bool boolean: writer.WriteBooleanValue(boolean); return;
            case JsonElement element: element.WriteTo(writer); return;
            case IDictionary<string, object?> fields:
                writer.WriteStartObject();
                foreach (var field in fields)
                {
                    writer.WritePropertyName(field.Key);
                    WriteJsonValue(writer, field.Value);
                }
                writer.WriteEndObject();
                return;
            case IEnumerable values:
                writer.WriteStartArray();
                foreach (var item in values) WriteJsonValue(writer, item);
                writer.WriteEndArray();
                return;
        }

        switch (Type.GetTypeCode(value.GetType()))
        {
            case TypeCode.Byte: writer.WriteNumberValue((byte)value); return;
            case TypeCode.SByte: writer.WriteNumberValue((sbyte)value); return;
            case TypeCode.Int16: writer.WriteNumberValue((short)value); return;
            case TypeCode.UInt16: writer.WriteNumberValue((ushort)value); return;
            case TypeCode.Int32: writer.WriteNumberValue((int)value); return;
            case TypeCode.UInt32: writer.WriteNumberValue((uint)value); return;
            case TypeCode.Int64: writer.WriteNumberValue((long)value); return;
            case TypeCode.UInt64: writer.WriteNumberValue((ulong)value); return;
            case TypeCode.Single: writer.WriteNumberValue((float)value); return;
            case TypeCode.Double: writer.WriteNumberValue((double)value); return;
            case TypeCode.Decimal: writer.WriteNumberValue((decimal)value); return;
            default: throw new InvalidOperationException("json_value_unsupported");
        }
    }

    private static T ResultBoundary<T>(Func<T> operation)
    {
        try { return operation(); }
        catch (WitException) { throw; }
        catch (InvalidOperationException ex)
        {
            var code = ex.Message;
            if (code.Length > 256) code = code[..256];
            throw new WitException<string>(string.IsNullOrWhiteSpace(code) ? "ollama_provider_error" : code, 0);
        }
        catch
        {
            throw new WitException<string>("ollama_provider_internal_error", 0);
        }
    }

    private static (JsonDocument Config, H.EndpointGrant Endpoint) Resolve(L.ProviderContext context)
    {
        JsonDocument config;
        try { config = JsonDocument.Parse(context.configurationJson); }
        catch { throw new InvalidOperationException("configuration_json_invalid"); }
        var root = config.RootElement;
        if (root.ValueKind != JsonValueKind.Object) { config.Dispose(); throw new InvalidOperationException("configuration_object_required"); }
        if (!root.TryGetProperty("endpointName", out var endpointName) || endpointName.GetString() != "ollama") { config.Dispose(); throw new InvalidOperationException("endpointName_must_be_ollama"); }
        if (root.TryGetProperty("model", out var model) && (model.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(model.GetString()))) { config.Dispose(); throw new InvalidOperationException("model_must_be_nonempty_string"); }
        var grant = context.endpoints.FirstOrDefault(e => e.name == "ollama" && !string.IsNullOrWhiteSpace(e.handle));
        if (string.IsNullOrWhiteSpace(grant.handle) || !Uri.TryCreate(grant.baseUrl, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https") || uri.Query.Length != 0 || uri.Fragment.Length != 0 || uri.AbsolutePath != "/")
        { config.Dispose(); throw new InvalidOperationException("approved_ollama_endpoint_missing_or_invalid"); }
        return (config, grant);
    }

    private static BrokerRequest HttpRequest(H.EndpointGrant endpoint, string path, string method, byte[]? body = null)
    {
        if (path is not ("/api/tags" or "/api/show" or "/api/chat")) throw new InvalidOperationException("ollama_path_invalid");
        var uri = new Uri(endpoint.baseUrl.TrimEnd('/') + path, UriKind.Absolute);
        return new BrokerRequest(uri.ToString(), method,
            [new Header("accept", "application/json")], body,
            body is null ? null : "application/json", 30_000, 8 * 1024 * 1024,
            200, 299, endpoint.handle, null, null, null);
    }

    private static JsonDocument ReadJson(H.EndpointGrant endpoint, string path, string method, object? body = null)
    {
        var bytes = body is null ? null : SerializeJson(body);
        using var stream = new NdjsonStream(new HostBroker(), HttpRequest(endpoint, path, method, bytes));
        var status = stream.Status();
        if (status is < 200 or > 299) throw new InvalidOperationException($"ollama_http_{status}");
        using var output = new MemoryStream();
        while (stream.ReadLine() is { } line)
        {
            if (output.Length + line.Length + 1 > 8 * 1024 * 1024) throw new InvalidOperationException("ollama_response_too_large");
            output.Write(line);
            output.WriteByte((byte)'\n');
        }
        try { return JsonDocument.Parse(output.ToArray()); }
        catch { throw new InvalidOperationException("ollama_json_invalid"); }
    }

    private static List<string> Models(H.EndpointGrant endpoint)
    {
        using var json = ReadJson(endpoint, "/api/tags", "GET");
        if (!json.RootElement.TryGetProperty("models", out var models) || models.ValueKind != JsonValueKind.Array) throw new InvalidOperationException("ollama_tags_invalid");
        return models.EnumerateArray().Select(item =>
            item.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String ? name.GetString() :
            item.TryGetProperty("model", out var model) && model.ValueKind == JsonValueKind.String ? model.GetString() : null)
            .Where(name => !string.IsNullOrWhiteSpace(name)).Select(name => name!).ToList();
    }

    private static HashSet<string> Capabilities(H.EndpointGrant endpoint, string model)
    {
        using var json = ReadJson(endpoint, "/api/show", "POST", new Dictionary<string, object?> { ["model"] = model });
        if (!json.RootElement.TryGetProperty("capabilities", out var values) || values.ValueKind != JsonValueKind.Array) return [];
        return values.EnumerateArray().Where(v => v.ValueKind == JsonValueKind.String).Select(v => v.GetString()!).ToHashSet(StringComparer.Ordinal);
    }

    private static string Text(L.ContentPart part) => part.Tag switch
    {
        0 => part.AsText, 3 => part.AsToolResult, 4 => part.AsReasoning,
        _ => throw new InvalidOperationException("unsupported_message_part")
    };

    private static object ChatBody(L.LlmRequest request, HashSet<string> caps)
    {
        if (string.IsNullOrWhiteSpace(request.model)) throw new InvalidOperationException("model_required");
        if (request.tools.Count > 0 && !caps.Contains("tools")) throw new InvalidOperationException("model_does_not_support_tools");
        var messages = new List<Dictionary<string, object?>>();
        foreach (var message in request.messages)
        {
            var content = new StringBuilder();
            var images = new List<string>();
            foreach (var part in message.parts)
            {
                if (part.Tag == 6)
                {
                    if (!caps.Contains("vision")) throw new InvalidOperationException("model_does_not_support_vision");
                    var value = part.AsMediaRef;
                    var marker = value.IndexOf(";base64,", StringComparison.Ordinal);
                    if (!value.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase) || marker < 0) throw new InvalidOperationException("vision_requires_base64_image_data_uri");
                    var encoded = value[(marker + 8)..];
                    try { _ = Convert.FromBase64String(encoded); } catch { throw new InvalidOperationException("vision_image_data_invalid"); }
                    images.Add(encoded);
                }
                else if (part.Tag is 0 or 3 or 4) content.Append(Text(part));
                else if (part.Tag is not (7 or 8)) throw new InvalidOperationException("unsupported_message_part");
            }
            var item = new Dictionary<string, object?> { ["role"] = message.role, ["content"] = content.ToString() };
            if (images.Count > 0) item["images"] = images;
            messages.Add(item);
        }
        var body = new Dictionary<string, object?> { ["model"] = request.model, ["messages"] = messages, ["stream"] = true };
        if (request.tools.Count > 0)
        {
            body["tools"] = request.tools.Select(tool => (object?)new Dictionary<string, object?>
            {
                ["type"] = "function",
                ["function"] = new Dictionary<string, object?>
                {
                    ["name"] = tool.name,
                    ["description"] = tool.description,
                    ["parameters"] = JsonDocument.Parse(tool.schemaJson).RootElement.Clone()
                }
            }).ToArray();
        }
        if (request.responseFormat is { } format)
        {
            if (format.kind == "json") body["format"] = format.schemaJson is null ? "json" : JsonDocument.Parse(format.schemaJson).RootElement.Clone();
            else if (format.kind != "text") throw new InvalidOperationException("response_format_unsupported");
        }
        if (request.sampling is { } sampling)
        {
            var options = new Dictionary<string, object>();
            if (sampling.temperature is { } temperature) options["temperature"] = temperature;
            if (sampling.topP is { } topP) options["top_p"] = topP;
            if (sampling.maxOutputTokens is { } maxTokens) options["num_predict"] = maxTokens;
            if (options.Count > 0) body["options"] = options;
        }
        if (request.extensionsJson is { } extensions)
        {
            using var parsed = JsonDocument.Parse(extensions);
            if (parsed.RootElement.ValueKind != JsonValueKind.Object) throw new InvalidOperationException("extensions_json_invalid");
            if (parsed.RootElement.TryGetProperty("think", out var think) && think.ValueKind == JsonValueKind.True)
            {
                if (!caps.Contains("thinking")) throw new InvalidOperationException("model_does_not_support_thinking");
                body["think"] = true;
            }
        }
        return body;
    }

    private static L.ProviderEvent Event(string requestId, L.ContentPart? part = null, L.Usage? usage = null, L.FinishReason? finish = null, L.TypedError? error = null) =>
        new(requestId, part, usage, finish, null, error, null, null);

    // docs:snippet-start provider-discovery:csharp
    public static L.ProviderDescriptor Describe(L.ProviderContext context)
    {
        return ResultBoundary(() =>
        {
            var (config, endpoint) = Resolve(context);
            using (config)
            {
                var models = Models(endpoint);
                var selected = config.RootElement.TryGetProperty("model", out var model) ? models.Where(m => m == model.GetString()) : models.Take(64);
                var caps = new HashSet<string>(StringComparer.Ordinal);
                foreach (var name in selected) caps.UnionWith(Capabilities(endpoint, name));
                var advertised = new List<L.ProviderCapability> { new("chat", false), new("streaming", false) };
                foreach (var capability in new[] { ("tools", "tools"), ("vision", "images"), ("thinking", "reasoning") })
                    if (caps.Contains(capability.Item1)) advertised.Add(new(capability.Item2, true));
                return new L.ProviderDescriptor("community.ollama", "Ollama", "0.1.0", models, advertised);
            }
        });
    }
    // docs:snippet-end provider-discovery:csharp

    public static L.ConfigurationReport ValidateConfiguration(string configJson, L.ProviderContext context)
    {
        var diagnostics = new List<string>();
        var ctx = new L.ProviderContext(configJson, context.endpoints);
        try
        {
            var (config, endpoint) = Resolve(ctx);
            using (config)
            {
                if (config.RootElement.TryGetProperty("model", out var model) && !Models(endpoint).Contains(model.GetString()!, StringComparer.Ordinal))
                    diagnostics.Add("configured model is not present in /api/tags");
            }
        }
        catch (Exception ex) { diagnostics.Add(ex.Message); }
        return new(diagnostics.Count == 0, diagnostics);
    }

    public static List<string> ListModels(L.ProviderContext context)
    {
        return ResultBoundary(() =>
        {
            var (config, endpoint) = Resolve(context);
            using (config) return Models(endpoint);
        });
    }

    // docs:snippet-start provider-request:csharp
    public static uint Start(L.LlmRequest request, L.ProviderContext context)
    {
        return ResultBoundary(() =>
        {
            var (config, endpoint) = Resolve(context);
            using (config)
            {
                var caps = Capabilities(endpoint, request.model);
                var bytes = SerializeJson(ChatBody(request, caps));
                var stream = new NdjsonStream(new HostBroker(), HttpRequest(endpoint, "/api/chat", "POST", bytes));
                var status = stream.Status();
                if (status is < 200 or > 299) { stream.Dispose(); throw new InvalidOperationException($"ollama_http_{status}"); }
                var handle = unchecked((uint)Interlocked.Increment(ref _nextHandle));
                Sessions[handle] = new Session(stream, request.requestId);
                return handle;
            }
        });
    }
    // docs:snippet-end provider-request:csharp

    public static L.ProviderEvent? Next(uint handle)
    {
        if (!Sessions.TryGetValue(handle, out var session)) throw new WitException<string>("provider_stream_missing", 0);
        if (session.TerminalSent) return null;
        if (session.Cancelled)
        {
            session.TerminalSent = true;
            session.Stream.Dispose();
            return Event(session.RequestId, finish: L.FinishReason.Cancelled());
        }
        try
        {
            while (true)
            {
                if (session.Done)
                {
                    session.TerminalSent = true;
                    session.Stream.Dispose();
                    return Event(session.RequestId, finish: L.FinishReason.Stop());
                }
                var line = session.Stream.ReadLine();
                if (line is null) throw new InvalidOperationException("ollama_stream_ended_before_done");
                if (line.Length == 0) continue;
                using var record = JsonDocument.Parse(line);
                var root = record.RootElement;
                if (root.TryGetProperty("error", out var upstreamError) && upstreamError.ValueKind == JsonValueKind.String)
                {
                    session.TerminalSent = true;
                    session.Stream.Dispose();
                    return Event(session.RequestId, finish: L.FinishReason.Error(), error: new("ollama_error", upstreamError.GetString()![..Math.Min(256, upstreamError.GetString()!.Length)], false, null));
                }
                if (root.TryGetProperty("message", out var message))
                {
                    if (message.TryGetProperty("thinking", out var thinking) && thinking.GetString() is { Length: > 0 } thought) return Event(session.RequestId, L.ContentPart.Reasoning(thought));
                    if (message.TryGetProperty("content", out var content) && content.GetString() is { Length: > 0 } text) return Event(session.RequestId, L.ContentPart.Text(text));
                    if (message.TryGetProperty("tool_calls", out var calls) && calls.ValueKind == JsonValueKind.Array && calls.GetArrayLength() > 0)
                    {
                        var call = calls[0].GetProperty("function");
                        var name = call.GetProperty("name").GetString();
                        var args = call.TryGetProperty("arguments", out var arguments) ? arguments.GetRawText() : "{}";
                        if (!string.IsNullOrWhiteSpace(name)) return Event(session.RequestId, L.ContentPart.ToolCallDetails(new($"{session.RequestId}:ollama:{session.ToolIndex++}", name, args, true)));
                    }
                }
                if (root.TryGetProperty("done", out var done) && done.ValueKind == JsonValueKind.True)
                {
                    session.TerminalSent = true;
                    session.Stream.Dispose();
                    var input = Count(root, "prompt_eval_count"); var output = Count(root, "eval_count");
                    var hasUsage = root.TryGetProperty("prompt_eval_count", out _) || root.TryGetProperty("eval_count", out _);
                    var usage = hasUsage ? new L.Usage(input, output, null, null, input + output) : (L.Usage?)null;
                    var reason = root.TryGetProperty("done_reason", out var reasonValue) ? reasonValue.GetString() : "stop";
                    var finish = reason switch { "length" => L.FinishReason.Length(), "tool" or "tool_calls" => L.FinishReason.Tool(), null or "" or "stop" => L.FinishReason.Stop(), _ => L.FinishReason.Unknown(new(reason!, null)) };
                    return Event(session.RequestId, usage: usage, finish: finish);
                }
            }
        }
        catch (Exception ex)
        {
            session.TerminalSent = true;
            session.Stream.Dispose();
            return Event(session.RequestId, finish: L.FinishReason.Error(), error: new("ollama_stream_error", ex.Message.Length > 256 ? ex.Message[..256] : ex.Message, false, null));
        }
    }

    private static uint Count(JsonElement obj, string property) => obj.TryGetProperty(property, out var value) && value.TryGetUInt32(out var count) ? count : 0;
    public static void Cancel(uint handle) { if (Sessions.TryGetValue(handle, out var s) && !s.TerminalSent) { s.Stream.Cancel(); s.Cancelled = true; } }
    public static void Drop(uint handle) { if (Sessions.TryRemove(handle, out var s)) s.Stream.Dispose(); }
}

