namespace Glixo.ExtensionSdk.Http;

public sealed record Header(string Name, string Value);

/// <summary>Mirrors glixo:http/types@3.0.0. Implementations call generated WIT imports.</summary>
public sealed record BrokerRequest(
    string Url,
    string Method,
    IReadOnlyList<Header> Headers,
    byte[]? Body,
    string? ContentType,
    uint? TimeoutMs,
    uint? MaxResponseBytes,
    ushort? AcceptedStatusMin,
    ushort? AcceptedStatusMax,
    string? EndpointHandle,
    string? SecretHandle,
    string? AuthHeader,
    string? AuthScheme);

public interface IBroker
{
    uint Start(BrokerRequest request);
    ushort Status(uint handle);
    IReadOnlyList<Header> ResponseHeaders(uint handle);
    byte[]? Read(uint handle, uint maxBytes);
    void Cancel(uint handle);
    void Drop(uint handle);
}

/// <summary>Bounded line reader for host-brokered response bytes.</summary>
public sealed class NdjsonStream : IDisposable
{
    public const uint DefaultReadBytes = 16 * 1024;
    public const int DefaultMaxLineBytes = 1024 * 1024;

    private readonly IBroker _broker;
    private readonly uint _handle;
    private readonly int _maxLineBytes;
    private readonly List<byte> _pending = [];
    private bool _eof;
    private bool _released;

    public NdjsonStream(IBroker broker, BrokerRequest request, int maxLineBytes = DefaultMaxLineBytes)
    {
        _broker = broker;
        _handle = broker.Start(request);
        _maxLineBytes = Math.Max(1, maxLineBytes);
    }

    public ushort Status() => _broker.Status(_handle);
    public IReadOnlyList<Header> ResponseHeaders() => _broker.ResponseHeaders(_handle);

    public byte[]? ReadLine()
    {
        while (true)
        {
            var newline = _pending.IndexOf((byte)'\n');
            if (newline >= 0)
            {
                if (newline > _maxLineBytes) throw new InvalidDataException("ndjson_line_too_large");
                var line = _pending.GetRange(0, newline).ToArray();
                _pending.RemoveRange(0, newline + 1);
                return TrimCarriageReturn(line);
            }

            if (_pending.Count > _maxLineBytes) throw new InvalidDataException("ndjson_line_too_large");
            if (_eof)
            {
                if (_pending.Count == 0) return null;
                var line = TrimCarriageReturn(_pending.ToArray());
                _pending.Clear();
                if (line.Length > _maxLineBytes) throw new InvalidDataException("ndjson_line_too_large");
                return line;
            }

            var chunk = _broker.Read(_handle, DefaultReadBytes);
            if (chunk is null) _eof = true;
            else _pending.AddRange(chunk);
        }
    }

    public void Cancel()
    {
        if (_released) return;
        _broker.Cancel(_handle);
        Dispose();
    }

    public void Dispose()
    {
        if (_released) return;
        _broker.Drop(_handle);
        _released = true;
    }

    private static byte[] TrimCarriageReturn(byte[] line) =>
        line.Length > 0 && line[^1] == (byte)'\r' ? line[..^1] : line;
}
