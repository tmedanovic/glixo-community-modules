using System.Text;
using System.Text.Json;
using Glixo.ExtensionSdk.Http;
using Glixo.ExtensionSdk.State;
using Glixo.Reference.MailWatch;

var next = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=opaque";
var delta = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=opaque";
var message = new { id = "AAMkAGI1", receivedDateTime = "2026-10-01T10:00:00Z", from = new { emailAddress = new { address = "sender@example.test" } }, body = new { content = "never emitted" } };
var broker = new FixtureBroker(
    JsonSerializer.Serialize(new Dictionary<string, object?> { ["value"] = new[] { message }, ["@odata.nextLink"] = next }),
    JsonSerializer.Serialize(new Dictionary<string, object?> { ["value"] = new[] { message }, ["@odata.deltaLink"] = delta }));
var checkpoint = new MailCheckpoint { Initialized = true, DeltaUrl = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=prior" };
var result = MailWatch.Handle(Request("wake", checkpoint), broker, new EmptyState());
Require(result.Checkpoint.DeltaUrl == delta, "final delta cursor retained");
Require(result.Events.Count == 2 && result.Events[0].IdempotencyKey == result.Events[1].IdempotencyKey, "repeatable event key");
Require(result.Events[0].Payload.Sender == "sender@example.test", "sender metadata projected");
Require(!JsonSerializer.Serialize(result.Events).Contains("never emitted", StringComparison.Ordinal), "message body omitted");
Require(broker.Requests.Count == 2 && broker.Requests[0].SecretHandle == "oauth", "broker references the declared secret slot");
Require(broker.Requests.All(row => row.Method == "GET" && row.Body is null && row.Url.StartsWith("https://graph.microsoft.com/", StringComparison.Ordinal)), "only scoped GETs");
Require(broker.Dropped.Count == 2 && broker.Cancelled.Count == 0, "responses released");

var unsafeBroker = new FixtureBroker(JsonSerializer.Serialize(new Dictionary<string, object?> { ["value"] = Array.Empty<object>(), ["@odata.nextLink"] = "https://evil.example/v1.0/me/mailFolders/inbox/messages/delta" }));
try
{
    MailWatch.Handle(Request("wake", checkpoint), unsafeBroker, new EmptyState());
    throw new Exception("unsafe delta URL was accepted");
}
catch (InvalidOperationException ex) when (ex.Message == "graph_delta_url_outside_scope") { }
Require(unsafeBroker.Requests.Count == 1, "unsafe next link is rejected before network use");

foreach (var operation in new[] { "health", "stop" })
{
    var lifecycle = MailWatch.Handle(new MailServiceRequest { Kind = "backgroundServices", ContributionId = "mail-watch", Input = new MailServiceInput { Operation = operation } }, new FixtureBroker(), new EmptyState());
    Require(lifecycle.Events.Count == 0, $"{operation} makes no HTTP call");
}

Console.WriteLine("Mail Watch C# fixtures passed.");

static MailServiceRequest Request(string operation, MailCheckpoint checkpoint) => new()
{
    Kind = "backgroundServices",
    ContributionId = "mail-watch",
    Configuration = new MailServiceConfiguration(),
    Input = new MailServiceInput { Operation = operation, Checkpoint = checkpoint },
    Context = new MailServiceContext { ResourceHandles = new Dictionary<string, string> { ["oauth"] = "secret-slot-lease" } },
};

static void Require(bool condition, string message)
{
    if (!condition) throw new Exception($"Assertion failed: {message}");
}

sealed class FixtureBroker(params string[] responses) : IBroker
{
    readonly Queue<byte[]> _responses = new(responses.Select(Encoding.UTF8.GetBytes));
    readonly Dictionary<uint, MemoryStream> _active = [];
    uint _next = 1;
    public List<BrokerRequest> Requests { get; } = [];
    public List<uint> Cancelled { get; } = [];
    public List<uint> Dropped { get; } = [];

    public uint Start(BrokerRequest request)
    {
        Requests.Add(request);
        var handle = _next++;
        _active.Add(handle, new MemoryStream(_responses.Dequeue(), writable: false));
        return handle;
    }
    public ushort Status(uint handle) => 200;
    public IReadOnlyList<Header> ResponseHeaders(uint handle) => [new("content-type", "application/json")];
    public byte[]? Read(uint handle, uint maxBytes)
    {
        var stream = _active[handle];
        var bytes = new byte[maxBytes];
        var read = stream.Read(bytes, 0, bytes.Length);
        return read == 0 ? null : bytes[..read];
    }
    public void Cancel(uint handle) => Cancelled.Add(handle);
    public void Drop(uint handle)
    {
        Dropped.Add(handle);
        _active[handle].Dispose();
        _active.Remove(handle);
    }
}

sealed class EmptyState : IScopedState
{
    public string? Get(string key) => null;
    public void Set(string key, string value) { }
    public IReadOnlyList<string> List(string prefix) => [];
    public bool Delete(string key) => false;
}
