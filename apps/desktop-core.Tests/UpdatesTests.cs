using System.Security.Cryptography;
using System.Text;
using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

/// <summary>B6: the updater's decisions — signature, versions, when, and where to ask.</summary>
public class UpdatesTests
{
    /// <summary>
    /// Made by <c>tools/update-key.mjs</c> and <c>tools/sign-update.mjs</c> (Node), as CI makes them:
    /// the updater must accept exactly what the build signs. A throwaway test key.
    /// </summary>
    private const string NodeKey =
        "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEm1F/xnsrnogTWDxB/JBXbybsOk4eC822B+rjT/gCWc6oUSi2n///7EYI18slth2yUMoUcLAcIOX6OzGiieTYow==";

    private static readonly UpdateManifest NodeSigned = new(
        "0.3.42",
        "Sinf-update-0.3.42.exe",
        "e67245cde34579bd3b7d788c8932a9f8a60fc00a648f9682a5e842a267af3cc3",
        26,
        "9mNuLNSvfVZHZqIrLbpZz+8VOzikMkwlAtbBBBslRQ4vVO49e2fM8s3z1hUb0qYDvo1nj1OtckNY6y2bVjRwEQ==");

    private static (string PublicKey, UpdateManifest Manifest) Signed(string version, ECDsa? with = null)
    {
        using var own = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var key = with ?? own;
        var unsigned = new UpdateManifest(version, $"Sinf-update-{version}.exe", new string('a', 64), 1234, string.Empty);
        var signature = key.SignData(
            Encoding.UTF8.GetBytes(Updates.Message(unsigned)),
            HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        return (Convert.ToBase64String(key.ExportSubjectPublicKeyInfo()), unsigned with { Signature = Convert.ToBase64String(signature) });
    }

    [Fact]
    public void Accepts_what_the_build_signs_with_node()
    {
        Assert.True(Updates.SignatureValid(NodeSigned, NodeKey));
        Assert.Equal(
            "sinf-update:0.3.42:e67245cde34579bd3b7d788c8932a9f8a60fc00a648f9682a5e842a267af3cc3:26",
            Updates.Message(NodeSigned));
    }

    [Fact]
    public void Refuses_a_changed_version_size_hash_or_another_key()
    {
        Assert.False(Updates.SignatureValid(NodeSigned with { Version = "0.3.43" }, NodeKey));
        Assert.False(Updates.SignatureValid(NodeSigned with { Size = 27 }, NodeKey));
        Assert.False(Updates.SignatureValid(NodeSigned with { Sha256 = new string('0', 64) }, NodeKey));
        var (otherKey, _) = Signed("0.3.42");
        Assert.False(Updates.SignatureValid(NodeSigned, otherKey));
        Assert.False(Updates.SignatureValid(NodeSigned, null));
        Assert.False(Updates.SignatureValid(NodeSigned, "not base64!"));
        Assert.False(Updates.SignatureValid(NodeSigned with { Signature = "AAAA" }, NodeKey));
    }

    [Theory]
    [InlineData("0.3.112", "0.3.99", 1)]
    [InlineData("0.3.99", "0.3.112", -1)]
    [InlineData("0.3.5", "0.3.5.0", 0)]
    [InlineData("0.3.5.1", "0.3.5", 1)]
    [InlineData("1.0.0", "0.9.999", 1)]
    public void Compares_versions_as_numbers(string a, string b, int expected)
    {
        Assert.Equal(expected, Updates.Compare(a, b));
    }

    [Fact]
    public void Installs_only_a_newer_signed_version_outside_lessons()
    {
        var (key, manifest) = Signed("0.3.50");
        var latest = new LatestUpdate(manifest, Busy: false);
        Assert.Equal(UpdateStep.Install, Updates.Decide(key, "0.3.49", latest, lessonHere: false));
        Assert.Equal(UpdateStep.UpToDate, Updates.Decide(key, "0.3.50", latest, false));
        // An old signed installer offered again (a replay) is not a way back.
        Assert.Equal(UpdateStep.UpToDate, Updates.Decide(key, "0.3.51", latest, false));
        Assert.Equal(UpdateStep.WaitForLesson, Updates.Decide(key, "0.3.49", latest, lessonHere: true));
        Assert.Equal(UpdateStep.WaitForLesson, Updates.Decide(key, "0.3.49", latest with { Busy = true }, false));
        Assert.Equal(UpdateStep.Nothing, Updates.Decide(key, "0.3.49", new LatestUpdate(null, false), false));
        Assert.Equal(UpdateStep.Nothing, Updates.Decide(key, "0.3.49", null, false));
        // A build without the key never installs anything.
        Assert.Equal(UpdateStep.Disabled, Updates.Decide(null, "0.3.49", latest, false));
        var (otherKey, _) = Signed("0.3.50");
        Assert.Equal(UpdateStep.BadSignature, Updates.Decide(otherKey, "0.3.49", latest, false));
    }

    [Fact]
    public void Reads_the_servers_answer_strictly()
    {
        var json = """
            {"update":{"version":"0.3.42","file":"Sinf-update-0.3.42.exe","sha256":"e67245cde34579bd3b7d788c8932a9f8a60fc00a648f9682a5e842a267af3cc3","size":26,"signature":"9mNuLNSvfVZHZqIrLbpZz+8VOzikMkwlAtbBBBslRQ4vVO49e2fM8s3z1hUb0qYDvo1nj1OtckNY6y2bVjRwEQ=="},"busy":true}
            """;
        Assert.Equal(new LatestUpdate(NodeSigned, Busy: true), Updates.ParseLatest(json));
        Assert.Equal(new LatestUpdate(null, false), Updates.ParseLatest("""{"update":null,"busy":false}"""));
        Assert.Null(Updates.ParseLatest("<html>proxy login</html>"));
        // A file name that would leave the updates folder is no update.
        var escape = json.Replace("Sinf-update-0.3.42.exe", @"..\\..\\Windows\\evil.exe");
        Assert.Null(Updates.ParseLatest(escape)?.Update);
    }

    [Fact]
    public void Knows_a_lesson_only_from_a_recent_mark()
    {
        var now = DateTimeOffset.Parse("2026-11-21T10:00:00Z");
        Activity At(int minutesAgo, bool lesson) => new(now.AddMinutes(-minutesAgo), "student", lesson, null, null);
        Assert.True(Updates.LessonHere([At(1, true)], now));
        Assert.False(Updates.LessonHere([At(1, false)], now));
        // Sinf was killed in the middle of a lesson an hour ago: that is not a lesson now.
        Assert.False(Updates.LessonHere([At(60, true)], now));
        // A clock far in the future is not believed either.
        Assert.False(Updates.LessonHere([At(-60, true)], now));
    }

    [Fact]
    public void Asks_the_classroom_server_first_then_the_platform()
    {
        var now = DateTimeOffset.Parse("2026-11-21T10:00:00Z");
        var sources = Updates.Sources(
        [
            new Activity(now.AddDays(-1), "teacher", false, "http://127.0.0.1:3001", "https://sinf.uz/"),
            new Activity(now, "teacher", false, "http://127.0.0.1:3000/", "https://sinf.uz"),
            new Activity(now, "student", false, "file:///C:/evil", null),
        ]);
        Assert.Equal(["http://127.0.0.1:3000", "http://127.0.0.1:3001", "https://sinf.uz"], sources);
    }

    [Fact]
    public void Writes_and_reads_the_activity_mark()
    {
        var mark = new Activity(DateTimeOffset.Parse("2026-11-21T10:00:00Z"), "student", true, "http://192.168.1.5:3000", null);
        Assert.Equal(mark, Updates.ParseActivity(Updates.ToJson(mark)));
        Assert.Null(Updates.ParseActivity("{}"));
        Assert.Null(Updates.ParseActivity("not json"));
    }

    [Fact]
    public void Updates_silently_keeping_the_role()
    {
        Assert.Equal(
            ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/UPDATE=1", @"/LOG=C:\log.txt"],
            Updates.InstallerArguments(@"C:\log.txt"));
    }
}
