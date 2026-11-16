using System.Text.Json;
using Glixo.ExtensionSdk.Workspace;
using Health = Glixo.Reference.WorkspaceHealth.Handler;
using Index = Glixo.Reference.DocumentIndex.Handler;

var workspace = new FakeWorkspace();
using (var result = JsonDocument.Parse(Health.Invoke("""{"kind":"tools","contributionId":"inspect","input":{},"context":{"resourceHandles":{"workspace":"host-handle"}}}""", workspace)))
{
    Assert(result.RootElement.GetProperty("eligibleFileTotals").ValueKind == JsonValueKind.Null, "partial inventory cannot claim complete eligible totals");
    Assert(result.RootElement.GetProperty("sampledBytes").GetInt64() == 5004, "sampled byte sum");
    Assert(result.RootElement.GetProperty("largestFiles")[0].GetProperty("path").GetString() == "z.cs", "largest files sorted by size");
    Assert(workspace.Queries.Single() == ("host-handle", "", 100u), "only host-stamped handle and bounded path inventory");
}
workspace.Queries.Clear();
using (var result = JsonDocument.Parse(Index.Invoke("""{"kind":"dataSources","contributionId":"search","input":{"query":"cs","excerptBytes":3},"context":{"resourceHandles":{"workspace":"host-handle"}}}""", workspace)))
{
    Assert(result.RootElement.GetProperty("items")[0].GetProperty("excerpt").GetString() == "a", "UTF-8 excerpt does not split a multibyte character");
    Assert(result.RootElement.GetProperty("items")[1].GetProperty("excerpt").ValueKind == JsonValueKind.Null, "large file isn't read");
    Assert(workspace.Reads.SequenceEqual(new[] { ("host-handle", "a.cs", 4096u) }), "only small matched path is read with the host bound");
    Assert(workspace.Queries.Single() == ("host-handle", "cs", 10u), "query is passed as path substring without content search");
}
ExpectDenied(() => Health.Invoke("""{"kind":"tools","contributionId":"inspect","input":{},"context":{}}""", workspace), "workspace_handle_missing");
workspace.Result = """{"items":[{"path":"../secret","bytes":1}],"truncated":false}""";
ExpectDenied(() => Health.Invoke("""{"kind":"tools","contributionId":"inspect","input":{},"context":{"resourceHandles":{"workspace":"host-handle"}}}""", workspace), "workspace_search_item_invalid");
Console.WriteLine("Workspace C# reference fixtures passed (partial inventory, bounds, UTF-8, handle and path validation).");

static void Assert(bool condition, string detail) { if (!condition) throw new Exception(detail); }
static void ExpectDenied(Action action, string code)
{
    try { action(); throw new Exception("expected denial: " + code); }
    catch (InvalidOperationException error) when (error.Message == code) { }
}
sealed class FakeWorkspace : IWorkspaceReader
{
    public string Result = """{"items":[{"path":"z.cs","bytes":5000},{"path":"a.cs","bytes":4}],"truncated":true}""";
    public List<(string, string, uint)> Queries { get; } = [];
    public List<(string, string, uint)> Reads { get; } = [];
    public string Search(string handle, string query, uint limit) { Queries.Add((handle, query, limit)); return Result; }
    public string Read(string handle, string path, uint maxBytes) { Reads.Add((handle, path, maxBytes)); return "a€"; }
}
