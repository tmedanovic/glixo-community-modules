using System.Buffers;
using System.Text;
using System.Text.Json;

namespace Glixo.Reference.WorkflowTextStats;

public static class Handler
{
    private const int MaximumTextScalars = 65_536;
    private const int MaximumMinimumWordLength = 128;

    // docs:snippet-start workflow-text-stats-handler:csharp
    public static string Invoke(string requestJson)
    {
        if (Encoding.UTF8.GetByteCount(requestJson) > 128 * 1024)
            throw new InvalidOperationException("guest_envelope_invalid");
        try
        {
            using var document = JsonDocument.Parse(requestJson, new JsonDocumentOptions { MaxDepth = 24 });
            var root = document.RootElement;
            if (root.GetProperty("kind").GetString() != "tools" || root.GetProperty("contributionId").GetString() != "text-stats")
                throw new InvalidOperationException("contribution_mismatch");

            var input = root.GetProperty("input");
            if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty("text", out var textElement) || textElement.ValueKind != JsonValueKind.String)
                throw new InvalidOperationException("text_required");
            var text = textElement.GetString() ?? throw new InvalidOperationException("text_required");
            var includeWhitespace = OptionalBoolean(input, "includeWhitespace", true);
            var minimumWordLength = OptionalInteger(input, "minimumWordLength", 1, 1, MaximumMinimumWordLength);
            var result = Analyze(text, includeWhitespace, minimumWordLength);

            var output = new ArrayBufferWriter<byte>();
            using (var writer = new Utf8JsonWriter(output))
            {
                writer.WriteStartObject();
                writer.WriteNumber("wordCount", result.WordCount);
                writer.WriteNumber("characterCount", result.CharacterCount);
                writer.WriteEndObject();
            }
            return Encoding.UTF8.GetString(output.WrittenSpan);
        }
        catch (InvalidOperationException)
        {
            throw;
        }
        catch (JsonException)
        {
            throw new InvalidOperationException("guest_envelope_invalid");
        }
        catch (KeyNotFoundException)
        {
            throw new InvalidOperationException("guest_envelope_invalid");
        }
    }

    public static StatsResult Analyze(string text, bool includeWhitespace = true, int minimumWordLength = 1)
    {
        if (minimumWordLength < 1 || minimumWordLength > MaximumMinimumWordLength)
            throw new InvalidOperationException("minimum_word_length_out_of_range");

        var wordCount = 0;
        var characterCount = 0;
        var currentWordLength = 0;
        var scalarCount = 0;
        foreach (var rune in text.EnumerateRunes())
        {
            scalarCount++;
            if (scalarCount > MaximumTextScalars) throw new InvalidOperationException("text_too_long");
            if (IsWhiteSpace(rune.Value))
            {
                if (includeWhitespace) characterCount++;
                if (currentWordLength >= minimumWordLength) wordCount++;
                currentWordLength = 0;
            }
            else
            {
                characterCount++;
                currentWordLength++;
            }
        }
        if (currentWordLength >= minimumWordLength) wordCount++;
        return new StatsResult(wordCount, characterCount);
    }

    private static bool OptionalBoolean(JsonElement input, string name, bool fallback)
    {
        if (!input.TryGetProperty(name, out var value)) return fallback;
        if (value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            throw new InvalidOperationException("include_whitespace_invalid");
        return value.GetBoolean();
    }

    private static int OptionalInteger(JsonElement input, string name, int fallback, int minimum, int maximum)
    {
        if (!input.TryGetProperty(name, out var value)) return fallback;
        if (!value.TryGetInt32(out var number) || number < minimum || number > maximum)
            throw new InvalidOperationException("minimum_word_length_out_of_range");
        return number;
    }

    private static bool IsWhiteSpace(int scalar) => scalar is >= 0x0009 and <= 0x000D
        or 0x0020 or 0x0085 or 0x00A0 or 0x1680
        or >= 0x2000 and <= 0x200A or 0x2028 or 0x2029 or 0x202F or 0x205F or 0x3000;
    // docs:snippet-end workflow-text-stats-handler:csharp
}

public sealed record StatsResult(int WordCount, int CharacterCount);
