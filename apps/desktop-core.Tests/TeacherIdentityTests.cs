using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

public class TeacherIdentityTests
{
    [Fact]
    public void Signs_and_verifies_and_nothing_else_verifies()
    {
        using var teacher = TeacherIdentity.Create();
        using var other = TeacherIdentity.Create();
        var sig = teacher.Sign("урок");
        Assert.True(TeacherIdentity.Verify(teacher.PublicKey, "урок", sig));
        Assert.False(TeacherIdentity.Verify(teacher.PublicKey, "урок!", sig));
        Assert.False(TeacherIdentity.Verify(other.PublicKey, "урок", sig));
        Assert.False(TeacherIdentity.Verify(null, "урок", sig));
        Assert.False(TeacherIdentity.Verify(teacher.PublicKey, "урок", null));
        Assert.False(TeacherIdentity.Verify("not base64!", "урок", sig));
        Assert.False(TeacherIdentity.Verify("AAAA", "урок", sig));
        Assert.False(TeacherIdentity.Verify(teacher.PublicKey, "урок", "AAAA"));
    }

    [Fact]
    public void The_key_survives_a_restart_in_its_file()
    {
        var path = Path.Combine(Path.GetTempPath(), $"sinf-key-{Guid.NewGuid():N}", "teacher.key");
        try
        {
            using var first = TeacherIdentity.LoadOrCreate(path);
            using var again = TeacherIdentity.LoadOrCreate(path);
            Assert.Equal(first.PublicKey, again.PublicKey);
            Assert.True(TeacherIdentity.Verify(first.PublicKey, "x", again.Sign("x")));

            // A spoilt file is replaced by a new key rather than stopping the lesson.
            File.WriteAllText(path, "spoilt");
            using var fresh = TeacherIdentity.LoadOrCreate(path);
            Assert.NotEqual(first.PublicKey, fresh.PublicKey);
        }
        finally
        {
            Directory.Delete(Path.GetDirectoryName(path)!, recursive: true);
        }
    }

    [Fact]
    public void A_fingerprint_is_short_readable_and_stable()
    {
        using var teacher = TeacherIdentity.Create();
        var print = TeacherIdentity.Fingerprint(teacher.PublicKey);
        Assert.Matches("^[0-9A-F]{4}-[0-9A-F]{4}$", print);
        Assert.Equal(print, TeacherIdentity.Fingerprint(teacher.PublicKey));
        using var other = TeacherIdentity.Create();
        Assert.NotEqual(print, TeacherIdentity.Fingerprint(other.PublicKey));
    }
}
