using System.Text;
using System.Text.Json;
using Glixo.ExtensionSdk.Http;
using Glixo.Reference.IssueLookup;

const string request = """
{"kind":"tools","contributionId":"issue-lookup","configuration":{"endpointName":"issues"},"input":{"issueKey":"DEMO-17"},"context":{"endpoints":[{"name":"issues","handle":"approved-opaque-handle","baseUrl":"https://issues.example.test"}]}}
""";

var broker = new FixtureBroker("""
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"DEMO-17 is open"}]}}
""");
using var result = JsonDocument.Parse(IssueLookup.Handle(request, broker));
if (result.RootElement.GetProperty("summary").GetString() != "DEMO-17 is open") throw new Exception("summary was not returned");
if (broker.Request is not { Method: "POST", EndpointHandle: "approved-opaque-handle" } || broker.Request.Url != "https://issues.example.test/mcp") throw new Exception("call escaped the approved endpoint grant");
if (broker.Cancelled || !broker.Dropped) throw new Exception("response handle lifecycle is incorrect");

var rejected = new FixtureBroker("{}");
try
{
    IssueLookup.Handle(request.Replace("DEMO-17", "bad", StringComparison.Ordinal), rejected);
    throw new Exception("invalid key was accepted");
}
catch (InvalidOperationException error) when (error.Message == "issue_key_invalid") { }
if (rejected.Request is not null) throw new Exception("invalid input started HTTP");

var trailingNewline = new FixtureBroker("{}");
try
{
    IssueLookup.Handle(request.Replace("DEMO-17", "DEMO-17\\n", StringComparison.Ordinal), trailingNewline);
    throw new Exception("terminal newline issue key was accepted");
}
catch (InvalidOperationException error) when (error.Message == "issue_key_invalid") { }
if (trailingNewline.Request is not null) throw new Exception("newline key started HTTP");
Console.WriteLine("Issue Lookup C# fixtures passed.");

sealed class FixtureBroker(string response) : IBroker
{
    private readonly MemoryStream _response = new(Encoding.UTF8.GetBytes(response));
    public BrokerRequest? Request { get; private set; }
    public bool Cancelled { get; private set; }
    public bool Dropped { get; private set; }
    public uint Start(BrokerRequest request) { Request = request; return 1; }
    public ushort Status(uint handle) => 200;
    public IReadOnlyList<Header> ResponseHeaders(uint handle) => [new("content-type", "application/json")];
    public byte[]? Read(uint handle, uint maxBytes)
    {
        var buffer = new byte[maxBytes];
        var count = _response.Read(buffer, 0, buffer.Length);
        return count == 0 ? null : buffer[..count];
    }
    public void Cancel(uint handle) => Cancelled = true;
    public void Drop(uint handle) { Dropped = true; _response.Dispose(); }
}
