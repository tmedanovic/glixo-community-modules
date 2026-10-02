using System.Text.Json;
using Glixo.Reference.WorkflowTextStats;

var fixturePaths = new[]
{
    Path.Combine(Environment.CurrentDirectory, "references", "_shared", "goldens", "workflow-text-stats", "cases.json"),
    Path.Combine(Environment.CurrentDirectory, "shared", "goldens", "workflow-text-stats", "cases.json"),
    Path.Combine(Environment.CurrentDirectory, "..", "shared", "goldens", "workflow-text-stats", "cases.json"),
    Path.Combine(Environment.CurrentDirectory, "..", "..", "..", "_shared", "goldens", "workflow-text-stats", "cases.json"),
    Path.Combine(Environment.CurrentDirectory, "..", "..", "_shared", "goldens", "workflow-text-stats", "cases.json"),
};
var fixturePath = fixturePaths.FirstOrDefault(File.Exists) ?? throw new Exception("Shared workflow-text-stats cases.json was not found");
using var fixture = JsonDocument.Parse(File.ReadAllText(fixturePath));
foreach (var item in fixture.RootElement.GetProperty("cases").EnumerateArray())
{
    using var result = JsonDocument.Parse(Handler.Invoke(item.GetProperty("request").GetRawText()));
    if (result.RootElement.GetProperty("wordCount").GetInt32() != item.GetProperty("expectedResponse").GetProperty("wordCount").GetInt32()
        || result.RootElement.GetProperty("characterCount").GetInt32() != item.GetProperty("expectedResponse").GetProperty("characterCount").GetInt32())
        throw new Exception($"Golden mismatch for {item.GetProperty("id").GetString()}");
}
try
{
    Handler.Analyze("text", minimumWordLength: 0);
    throw new Exception("Out-of-range minimum word length was accepted");
}
catch (InvalidOperationException error) when (error.Message == "minimum_word_length_out_of_range") { }
Console.WriteLine("workflow-text-stats C# behavior checks passed");
