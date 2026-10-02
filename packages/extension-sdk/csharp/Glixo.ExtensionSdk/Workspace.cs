namespace Glixo.ExtensionSdk.Workspace;

public interface IWorkspaceReader
{
    string Search(string hostHandle, string query, uint limit);
    string Read(string hostHandle, string path, uint maxBytes);
}
