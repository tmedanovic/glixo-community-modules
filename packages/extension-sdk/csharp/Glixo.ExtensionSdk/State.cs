namespace Glixo.ExtensionSdk.State;

public interface IScopedState
{
    string? Get(string key);
    void Set(string key, string value);
    IReadOnlyList<string> List(string prefix);
    bool Delete(string key);
}
