using Glixo.ExtensionSdk.Http;
using ContributionWorld.wit.Exports.glixo.contribution.v1_0_0;
using ContributionWorld.wit.Imports.glixo.contribution.v1_0_0;
using Http = ContributionWorld.wit.Imports.glixo.http.v3_0_0;

namespace ContributionWorld.wit.Exports.glixo.contribution.v1_0_0;

public static class GuestExportsImpl
{
    private sealed class HostBroker : IBroker
    {
        public uint Start(BrokerRequest request) => Http.IBrokerImports.HttpStart(new Http.ITypesImports.HttpRequest(
            request.Url, request.Method,
            request.Headers.Select(header => new Http.ITypesImports.Header(header.Name, header.Value)).ToList(),
            request.Body, request.ContentType, request.TimeoutMs, request.MaxResponseBytes,
            request.AcceptedStatusMin, request.AcceptedStatusMax, request.EndpointHandle,
            request.SecretHandle, request.AuthHeader, request.AuthScheme));
        public ushort Status(uint handle) => Http.IBrokerImports.HttpStatus(handle);
        public IReadOnlyList<Header> ResponseHeaders(uint handle) => Http.IBrokerImports.HttpResponseHeaders(handle)
            .Select(header => new Header(header.name, header.value)).ToArray();
        public byte[]? Read(uint handle, uint maxBytes) => Http.IBrokerImports.HttpRead(handle, maxBytes);
        public void Cancel(uint handle) => Http.IBrokerImports.HttpCancel(handle);
        public void Drop(uint handle) => Http.IBrokerImports.HttpDrop(handle);
    }

    public static string Invoke(string requestJson)
    {
        try { return Glixo.Reference.IssueLookup.IssueLookup.Handle(requestJson, new HostBroker()); }
        catch (Exception error)
        {
            throw new ContributionWorld.WitException<string>(error.Message[..Math.Min(error.Message.Length, 240)], 0);
        }
    }
}
