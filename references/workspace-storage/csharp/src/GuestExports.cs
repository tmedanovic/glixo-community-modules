using System.Text.Json;
using Glixo.WorkspaceStorage;
using Glixo.ExtensionSdk.State;
using ContributionWorld.wit.Imports.glixo.contribution.v1_0_0;

namespace ContributionWorld.wit.Exports.glixo.contribution.v1_0_0;

public static class GuestExportsImpl
{
    private sealed class HostState : IScopedState
    {
        public string? Get(string key) => IBrokerImports.StateGet(key);
        public void Set(string key, string value) => IBrokerImports.StateSet(key, value);
        public IReadOnlyList<string> List(string prefix) => IBrokerImports.StateList(prefix);
        public bool Delete(string key) => IBrokerImports.StateDelete(key);
    }

    public static string Invoke(string requestJson)
    {
        try { return StorageHandler.Handle(requestJson, new HostState()).GetRawText(); }
        catch (Exception error) { throw new InvalidOperationException(error.Message); }
    }
}
