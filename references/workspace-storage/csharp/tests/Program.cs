using System.Text.Json;
using Glixo.ExtensionSdk.State;
using Glixo.WorkspaceStorage;

var state = new MemoryState();
state.Set(StorageHandler.TestPrefix + "zeta", "seed");
var set = Invoke("set", "\"key\":\"alpha\",\"value\":\"green\"");
Require(set.GetProperty("stored").GetBoolean(), "set result");
Require(state.Get(StorageHandler.TestPrefix + "alpha") == "green", "set is stored in the scoped prefix");
var get = Invoke("get", "\"key\":\"alpha\"");
Require(get.GetProperty("value").GetString() == "green", "get result");
var list = Invoke("list", "\"prefix\":\"\"");
Require(string.Join(',', list.GetProperty("keys").EnumerateArray().Select(item => item.GetString())) == "alpha,zeta", "list is bounded and sorted");
Require(Invoke("delete", "\"key\":\"alpha\"").GetProperty("deleted").GetBoolean(), "delete result");
Require(Invoke("get", "\"key\":\"alpha\"").GetProperty("value").ValueKind == JsonValueKind.Null, "deleted value is absent");
foreach (var key in new[] { "../outside", "nested/key", "", ".", ".." })
    Require(Throws(() => Invoke("get", $"\"key\":{JsonSerializer.Serialize(key)}"), "storage_key_invalid"), $"rejects key {key}");
Require(Throws(() => Invoke("set", $"\"key\":\"large\",\"value\":{JsonSerializer.Serialize(new string('x', 4097))}"), "value_too_large"), "rejects oversized values");
Console.WriteLine("Workspace Storage C# checks passed (set/get/list/delete, namespace, invalid inputs).");
return;

JsonElement Invoke(string operation, string fields) => StorageHandler.Handle(
    "{\"kind\":\"tools\",\"contributionId\":\"storage\",\"input\":{\"operation\":"
        + JsonSerializer.Serialize(operation) + "," + fields + "}}",
    state);
bool Throws(Action action, string code)
{
    try { action(); return false; }
    catch (InvalidOperationException error) { return error.Message == code; }
}
void Require(bool condition, string name) { if (!condition) throw new InvalidOperationException("check_failed:" + name); }

sealed class MemoryState : IScopedState
{
    private readonly Dictionary<string, string> values = new(StringComparer.Ordinal);
    public string? Get(string key) => values.TryGetValue(key, out var value) ? value : null;
    public void Set(string key, string value) => values[key] = value;
    public IReadOnlyList<string> List(string prefix) => values.Keys.Where(key => key.StartsWith(prefix, StringComparison.Ordinal)).ToArray();
    public bool Delete(string key) => values.Remove(key);
}
