using System.Text.Json;
using Glixo.ExtensionSdk.Http;
using Glixo.ExtensionSdk.State;
using ContributionWorld.wit.Exports.glixo.contribution.v1_0_0;
using ContributionWorld.wit.Imports.glixo.contribution.v1_0_0;
using Http = ContributionWorld.wit.Imports.glixo.http.v3_0_0;

namespace ContributionWorld.wit.Exports.glixo.contribution.v1_0_0;

public static class GuestExportsImpl
{
    private sealed class HostBroker : IBroker
    {
        public uint Start(BrokerRequest request) => Http.IBrokerImports.HttpStart(new Http.ITypesImports.HttpRequest(
            request.Url,
            request.Method,
            request.Headers.Select(header => new Http.ITypesImports.Header(header.Name, header.Value)).ToList(),
            request.Body,
            request.ContentType,
            request.TimeoutMs,
            request.MaxResponseBytes,
            request.AcceptedStatusMin,
            request.AcceptedStatusMax,
            request.EndpointHandle,
            request.SecretHandle,
            request.AuthHeader,
            request.AuthScheme));

        public ushort Status(uint handle) => Http.IBrokerImports.HttpStatus(handle);
        public IReadOnlyList<Header> ResponseHeaders(uint handle) => Http.IBrokerImports.HttpResponseHeaders(handle)
            .Select(header => new Header(header.name, header.value))
            .ToArray();
        public byte[]? Read(uint handle, uint maxBytes) => Http.IBrokerImports.HttpRead(handle, maxBytes);
        public void Cancel(uint handle) => Http.IBrokerImports.HttpCancel(handle);
        public void Drop(uint handle) => Http.IBrokerImports.HttpDrop(handle);
    }

    private sealed class HostState : IScopedState
    {
        public string? Get(string key) => IBrokerImports.StateGet(key);
        public void Set(string key, string value) => IBrokerImports.StateSet(key, value);
        public IReadOnlyList<string> List(string prefix) => IBrokerImports.StateList(prefix);
        public bool Delete(string key) => IBrokerImports.StateDelete(key);
    }

    public static string Invoke(string requestJson)
    {
        try
        {
            var request = JsonSerializer.Deserialize(requestJson, Glixo.Reference.MailWatch.MailWatchJsonContext.Default.MailServiceRequest)
                ?? throw new InvalidOperationException("guest_request_invalid");
            var result = Glixo.Reference.MailWatch.MailWatch.Handle(request, new HostBroker(), new HostState());
            return JsonSerializer.Serialize(result, Glixo.Reference.MailWatch.MailWatchJsonContext.Default.MailServiceResult);
        }
        catch (Exception error)
        {
            try { IBrokerImports.Log("error", error.Message[..Math.Min(error.Message.Length, 240)]); }
            catch { /* Best-effort diagnostic import. */ }
            throw new ContributionWorld.WitException<string>(error.Message[..Math.Min(error.Message.Length, 240)], 0);
        }
    }
}
