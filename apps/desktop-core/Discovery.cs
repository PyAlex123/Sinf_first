using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Sinf.Desktop.Core;

/// <summary>What a student computer learns from the teacher's answer.</summary>
/// <param name="Url">Where the lesson is.</param>
/// <param name="ExitHash">Hash of the administrator's exit password (H3), when the teacher has set one.</param>
/// <param name="TeacherKey">The teacher computer's public key that signed the answer (H9).</param>
public sealed record TeacherFound(string Url, string? ExitHash, string TeacherKey);

/// <summary>
/// How a student computer finds the teacher's (ADR-014 §3). The student broadcasts a short question on
/// UDP with a fresh random nonce; the teacher's app answers with the address of its lesson, signed
/// together with that nonce by its own key (H9). Both messages are tiny JSON with a protocol version,
/// like the lesson protocol (CLAUDE.md §5.6).
/// </summary>
public static class Discovery
{
    public const int Port = 41234;

    /// <summary>2: answers are signed (H9). Answers of version 1 are not accepted any more.</summary>
    public const int Version = 2;
    private const string App = "sinf";

    /// <summary>Anything longer is not ours; reading it would only cost time.</summary>
    public const int MaxMessageBytes = 1024;

    private sealed record Message(
        [property: JsonPropertyName("app")] string? App,
        [property: JsonPropertyName("v")] int V,
        [property: JsonPropertyName("type")] string? Type,
        [property: JsonPropertyName("n")] string? Nonce = null,
        [property: JsonPropertyName("url")] string? Url = null,
        [property: JsonPropertyName("name")] string? Name = null,
        [property: JsonPropertyName("exit")] string? Exit = null,
        [property: JsonPropertyName("key")] string? Key = null,
        [property: JsonPropertyName("sig")] string? Sig = null);

    /// <summary>A new question's nonce: an old answer replayed later does not fit it.</summary>
    public static string NewNonce() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));

    public static byte[] Request(string nonce) =>
        Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new Message(App, Version, "find", nonce)));

    /// <summary>The nonce of a question, or null when the bytes are not a question.</summary>
    public static string? ReadRequest(ReadOnlySpan<byte> data) =>
        Read(data) is { Type: "find", Nonce: { } nonce } && IsNonce(nonce) ? nonce : null;

    private static bool IsNonce(string nonce) =>
        nonce.Length is >= 16 and <= 64 && nonce.All(c => char.IsAsciiLetterOrDigit(c) || c is '+' or '/' or '=');

    /// <summary>
    /// What the teacher's key signs: the asker's nonce and everything the student will act on — the
    /// address, the computer's name and the exit hash. One line each, so no field can borrow another's.
    /// </summary>
    private static string Signed(string nonce, string url, string? name, string? exit) =>
        $"sinf-here\n{Version}\n{nonce}\n{url}\n{name}\n{exit}";

    /// <summary>
    /// The teacher's answer: where its lesson is, which computer it is, and the hash of the exit
    /// password for the kiosks (H3) — the hash only, never the password — signed by its key (H9).
    /// </summary>
    public static byte[] Answer(string nonce, string lessonUrl, string? name, string? exitHash, TeacherIdentity identity) =>
        Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new Message(
            App,
            Version,
            "here",
            nonce,
            lessonUrl,
            name,
            exitHash,
            identity.PublicKey,
            identity.Sign(Signed(nonce, lessonUrl, name, exitHash)))));

    /// <summary>
    /// What a teacher's answer says, or null when it is not one we trust: not an answer to our nonce,
    /// not signed by the key it shows, signed by another key than the one this computer remembers, or
    /// pointing outside the school network.
    /// </summary>
    /// <param name="nonce">The nonce of our own question.</param>
    /// <param name="pinnedKey">The teacher this computer met first (H9, author's choice); null before that.</param>
    public static TeacherFound? ReadAnswer(ReadOnlySpan<byte> data, string nonce, string? pinnedKey)
    {
        var message = Read(data);
        if (message is not { Type: "here", Url: { } rawUrl, Key: { } key }
            || message.Nonce != nonce
            || (pinnedKey is not null && key != pinnedKey)
            || !TeacherIdentity.Verify(key, Signed(nonce, rawUrl, message.Name, message.Exit), message.Sig)
            || !TeacherAddress.TryNormalize(rawUrl, out var url))
        {
            return null;
        }

        // A hash we cannot read is dropped, not passed on: the kiosk would never open with it.
        var exit = ExitPassword.IsWellFormed(message.Exit) ? message.Exit : null;
        return new TeacherFound(url, exit, key);
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
