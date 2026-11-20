using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Sinf.Desktop.Core;

/// <summary>
/// How a student computer finds the teacher's (ADR-014 §3). The student broadcasts a short question on
/// UDP; the teacher's app answers with the address of its lesson. Both messages are tiny JSON with a
/// protocol version, like the lesson protocol (CLAUDE.md §5.6).
/// </summary>
public static class Discovery
{
    public const int Port = 41234;
    public const int Version = 1;
    private const string App = "sinf";

    /// <summary>Anything longer is not ours; reading it would only cost time.</summary>
    public const int MaxMessageBytes = 512;

    private sealed record Message(
        [property: JsonPropertyName("app")] string? App,
        [property: JsonPropertyName("v")] int V,
        [property: JsonPropertyName("type")] string? Type,
        [property: JsonPropertyName("url")] string? Url = null,
        [property: JsonPropertyName("name")] string? Name = null);

    public static byte[] Request() =>
        Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new Message(App, Version, "find")));

    public static bool IsRequest(ReadOnlySpan<byte> data) => Read(data) is { Type: "find" };

    /// <summary>The teacher's answer: where its lesson is and, for people, which computer it is.</summary>
    public static byte[] Answer(string lessonUrl, string? name) =>
        Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new Message(App, Version, "here", lessonUrl, name)));

    /// <summary>The lesson address from a teacher's answer, or null when the answer is not one we trust.</summary>
    public static string? ReadAnswer(ReadOnlySpan<byte> data)
    {
        var message = Read(data);
        if (message is not { Type: "here" } || !TeacherAddress.TryNormalize(message.Url, out var url))
        {
            return null;
        }

        return url;
    }

    private static Message? Read(ReadOnlySpan<byte> data)
    {
        if (data.Length == 0 || data.Length > MaxMessageBytes)
        {
            return null;
        }

        try
        {
            var message = JsonSerializer.Deserialize<Message>(data);
            return message is { App: App, V: Version } ? message : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// The directed broadcast address of a network: 192.168.1.15 with mask 255.255.255.0 gives
    /// 192.168.1.255. Windows sends 255.255.255.255 out of one adapter only, so each one gets its own.
    /// </summary>
    public static IPAddress DirectedBroadcast(IPAddress address, IPAddress mask)
    {
        var a = address.GetAddressBytes();
        var m = mask.GetAddressBytes();
        if (a.Length != 4 || m.Length != 4)
        {
            throw new ArgumentException("IPv4 only");
        }

        var result = new byte[4];
        for (var i = 0; i < 4; i++)
        {
            result[i] = (byte)(a[i] | ~m[i]);
        }

        return new IPAddress(result);
    }
}
