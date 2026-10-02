using System.Text.Json.Serialization;

namespace Glixo.Reference.MailWatch;

[JsonSourceGenerationOptions(GenerationMode = JsonSourceGenerationMode.Metadata)]
[JsonSerializable(typeof(MailServiceRequest))]
[JsonSerializable(typeof(MailServiceResult))]
internal partial class MailWatchJsonContext : JsonSerializerContext { }
