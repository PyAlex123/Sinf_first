using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Sinf.Desktop.Core;

/// <summary>What <c>update.json</c> says about an update installer (B6; packages/shared/src/updates.ts).</summary>
public sealed record UpdateManifest(string Version, string File, string Sha256, long Size, string Signature);

/// <summary>What a server answers to <c>/api/updates/latest</c>.</summary>
public sealed record LatestUpdate(UpdateManifest? Update, bool Busy);

/// <summary>
/// What Sinf.exe writes every minute into <c>%LOCALAPPDATA%\Sinf\activity.json</c>, so the updater —
/// running as SYSTEM, outside any user's session — knows where this computer's server is and whether
/// a child is in a lesson right now.
/// </summary>
/// <param name="ServerUrl">The teacher's own lesson server, or the one a student computer found.</param>
/// <param name="PlatformUrl">The platform, when the computer is paired with one.</param>
public sealed record Activity(
    DateTimeOffset At,
    string Role,
    bool InLesson,
    string? ServerUrl,
    string? PlatformUrl);

/// <summary>What the updater decides to do this time.</summary>
public enum UpdateStep
{
    /// <summary>The build has no public key: updates are off, and the log says so.</summary>
    Disabled,

    /// <summary>No server answered, or none has an update.</summary>
    Nothing,

    UpToDate,

    /// <summary>A lesson is on (here, or in the classroom): next time.</summary>
    WaitForLesson,

    /// <summary>The update's signature does not match the key: it is never installed.</summary>
    BadSignature,

    Install,
}

/// <summary>
/// The updater's decisions without Windows (B6, ADR-023): version order, the signature, where to ask
/// and whether now is the moment. The updater itself (apps/updater) does the downloading and the
/// installing; everything it decides is here and tested.
/// </summary>
public static class Updates
{
    /// <summary>A lesson mark older than this belongs to a Sinf that is no longer running.</summary>
    public static readonly TimeSpan ActivityFresh = TimeSpan.FromMinutes(3);

    private static readonly System.Text.RegularExpressions.Regex VersionPattern =
        new(@"^\d{1,4}\.\d{1,4}\.\d{1,6}(?:\.\d{1,6})?$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    private static readonly System.Text.RegularExpressions.Regex FilePattern =
        new(@"^[A-Za-z0-9._-]{1,120}\.exe$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    /// <summary>What the signature covers — exactly as the platform and tools/sign-update.mjs make it.</summary>
    public static string Message(UpdateManifest m) => $"sinf-update:{m.Version}:{m.Sha256}:{m.Size}";

    /// <summary>ECDSA P-256 / SHA-256, r‖s; the key is base64 SPKI as tools/update-key.mjs prints it.</summary>
    public static bool SignatureValid(UpdateManifest manifest, string? publicKey)
    {
        if (string.IsNullOrWhiteSpace(publicKey))
        {
            return false;
        }

        try
        {
            using var key = ECDsa.Create();
            key.ImportSubjectPublicKeyInfo(Convert.FromBase64String(publicKey.Trim()), out _);
            return key.VerifyData(
                Encoding.UTF8.GetBytes(Message(manifest)),
                Convert.FromBase64String(manifest.Signature),
                HashAlgorithmName.SHA256,
                DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        }
        catch (Exception error) when (error is FormatException or CryptographicException)
        {
            return false;
        }
    }

    /// <summary>"0.3.112" against "0.3.99": numbers, not text; a missing part is 0.</summary>
    public static int Compare(string a, string b)
    {
        var pa = a.Split('.');
        var pb = b.Split('.');
        for (var i = 0; i < Math.Max(pa.Length, pb.Length); i++)
        {
            var x = i < pa.Length && long.TryParse(pa[i], out var na) ? na : 0;
            var y = i < pb.Length && long.TryParse(pb[i], out var nb) ? nb : 0;
            if (x != y)
            {
                return x < y ? -1 : 1;
            }
        }

        return 0;
    }

    /// <summary>The server's answer, read strictly: anything odd is no update at all.</summary>
    public static LatestUpdate? ParseLatest(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var busy = root.TryGetProperty("busy", out var b) && b.ValueKind == JsonValueKind.True;
            if (!root.TryGetProperty("update", out var u) || u.ValueKind != JsonValueKind.Object)
            {
                return new LatestUpdate(null, busy);
            }

            var manifest = new UpdateManifest(
                u.GetProperty("version").GetString() ?? string.Empty,
                u.GetProperty("file").GetString() ?? string.Empty,
                u.GetProperty("sha256").GetString() ?? string.Empty,
                u.GetProperty("size").GetInt64(),
                u.GetProperty("signature").GetString() ?? string.Empty);
            return new LatestUpdate(WellFormed(manifest) ? manifest : null, busy);
        }
        catch (Exception error) when (error is JsonException or KeyNotFoundException or InvalidOperationException or FormatException)
        {
            return null;
        }
    }

    /// <summary>A file name the updater may write, a version it can compare, a hash it can check.</summary>
    public static bool WellFormed(UpdateManifest m) =>
        VersionPattern.IsMatch(m.Version)
        && FilePattern.IsMatch(m.File)
        && m.Sha256.Length == 64 && m.Sha256.All(c => c is (>= '0' and <= '9') or (>= 'a' and <= 'f'))
        && m.Size > 0;

    /// <summary>
    /// Install now? Only a newer, correctly signed version, and only when no lesson is on — neither
    /// on this computer nor, by the server's word, in its classroom.
    /// </summary>
    public static UpdateStep Decide(string? publicKey, string installed, LatestUpdate? latest, bool lessonHere)
    {
        if (string.IsNullOrWhiteSpace(publicKey))
        {
            return UpdateStep.Disabled;
        }

        if (latest?.Update is not { } update)
        {
            return UpdateStep.Nothing;
        }

        if (Compare(update.Version, installed) <= 0)
        {
            return UpdateStep.UpToDate;
        }

        if (!SignatureValid(update, publicKey))
        {
            return UpdateStep.BadSignature;
        }

        return latest.Busy || lessonHere ? UpdateStep.WaitForLesson : UpdateStep.Install;
    }

    /// <summary>Is a child in a lesson on this computer? Only a recent mark counts.</summary>
    public static bool LessonHere(IEnumerable<Activity> activities, DateTimeOffset now) =>
        activities.Any(a => a.InLesson && now - a.At < ActivityFresh && a.At - now < ActivityFresh);

    /// <summary>
    /// Where to ask, in order: the lesson servers the running Sinf named (the teacher's own, or the
    /// one a student computer found) — they keep a copy for the classroom — then the platform.
    /// Freshest first, each address once, only http(s).
    /// </summary>
    public static IReadOnlyList<string> Sources(IEnumerable<Activity> activities)
    {
        var ordered = activities.OrderByDescending(a => a.At).ToList();
        return ordered.Select(a => a.ServerUrl)
            .Concat(ordered.Select(a => a.PlatformUrl))
            .OfType<string>()
            .Select(u => u.Trim().TrimEnd('/'))
            .Where(u => Uri.TryCreate(u, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>Written by hand, not by reflection: the trimmed updater shares this code.</summary>
    public static string ToJson(Activity a)
    {
        using var buffer = new MemoryStream();
        using (var w = new Utf8JsonWriter(buffer))
        {
            w.WriteStartObject();
            w.WriteString("at", a.At.ToUniversalTime().ToString("O", System.Globalization.CultureInfo.InvariantCulture));
            w.WriteString("role", a.Role);
            w.WriteBoolean("inLesson", a.InLesson);
            w.WriteString("serverUrl", a.ServerUrl);
            w.WriteString("platformUrl", a.PlatformUrl);
            w.WriteEndObject();
        }

        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    public static Activity? ParseActivity(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var r = doc.RootElement;
            string? Text(string name) => r.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            if (!DateTimeOffset.TryParse(Text("at"), System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var at))
            {
                return null;
            }

            return new Activity(
                at,
                Text("role") ?? string.Empty,
                r.TryGetProperty("inLesson", out var l) && l.ValueKind == JsonValueKind.True,
                Text("serverUrl"),
                Text("platformUrl"));
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>The installer's switches for an update: silent, the computer's role kept from before.</summary>
    public static IReadOnlyList<string> InstallerArguments(string logFile) =>
        ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/UPDATE=1", $"/LOG={logFile}"];
}
