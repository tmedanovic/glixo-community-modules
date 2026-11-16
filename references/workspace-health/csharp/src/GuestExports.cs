using Glixo.ExtensionSdk.Workspace;
using ContributionWorld.wit.Imports.glixo.contribution.v1_0_0;

namespace ContributionWorld.wit.Exports.glixo.contribution.v1_0_0;

public static class GuestExportsImpl
{
    private sealed class HostWorkspace : IWorkspaceReader
    {
        public string Search(string handle, string query, uint limit) => IBrokerImports.WorkspaceSearch(handle, query, limit);
        public string Read(string handle, string path, uint maxBytes) => IBrokerImports.WorkspaceRead(handle, path, maxBytes);
    }

    public static string Invoke(string requestJson)
    {
        try { return Glixo.Reference.WorkspaceHealth.Handler.Invoke(requestJson, new HostWorkspace()); }
        catch (Exception error)
        {
            // Return stable codes without exposing arbitrary host path or document text.
            var code = error is InvalidOperationException && error.Message.All(c => char.IsAsciiLetterOrDigit(c) || c == '_')
                ? error.Message : "guest_request_invalid";
            throw new ContributionWorld.WitException<string>(code, 0);
        }
    }
}
