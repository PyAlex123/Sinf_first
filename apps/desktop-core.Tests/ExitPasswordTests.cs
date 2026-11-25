using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

public class ExitPasswordTests
{
    [Fact]
    public void A_hash_checks_its_own_password_only()
    {
        var hash = ExitPassword.Hash("sinf-2026!");
        Assert.StartsWith("pbkdf2-sha256$100000$", hash);
        Assert.True(ExitPassword.Verify("sinf-2026!", hash));
        Assert.False(ExitPassword.Verify("sinf-2027!", hash));
        Assert.False(ExitPassword.Verify("", hash));
        Assert.False(ExitPassword.Verify(null, hash));
    }

    [Fact]
    public void The_same_password_gives_different_hashes()
    {
        Assert.NotEqual(ExitPassword.Hash("sinf-2026!"), ExitPassword.Hash("sinf-2026!"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("sinf-2026!")]
    [InlineData("pbkdf2-sha256$100000$c2FsdA==")]
    [InlineData("pbkdf2-sha256$10$c2FsdHNhbHQ=$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")]
    [InlineData("md5$1$a$b")]
    public void Anything_but_our_format_is_not_a_hash(string? stored)
    {
        Assert.False(ExitPassword.IsWellFormed(stored));
        Assert.False(ExitPassword.Verify("sinf-2026!", stored));
    }

    [Fact]
    public void Passwords_shorter_than_eight_are_refused()
    {
        Assert.False(ExitPassword.IsStrongEnough("1234567"));
        Assert.True(ExitPassword.IsStrongEnough("12345678"));
    }

    [Fact]
    public void Five_wrong_tries_close_the_gate_for_a_minute()
    {
        var hash = ExitPassword.Hash("sinf-2026!");
        var gate = new ExitGate();
        var now = DateTimeOffset.Parse("2026-11-20T10:00:00Z");
        for (var i = 0; i < ExitGate.MaxFailures; i++)
        {
            Assert.False(gate.TryOpen("wrong", hash, now));
        }

        Assert.Equal(TimeSpan.FromMinutes(1), gate.Wait(now));
        // Even the right password waits.
        Assert.False(gate.TryOpen("sinf-2026!", hash, now.AddSeconds(30)));
        Assert.True(gate.TryOpen("sinf-2026!", hash, now.AddMinutes(1)));
        Assert.Equal(TimeSpan.Zero, gate.Wait(now.AddMinutes(1)));
    }

    [Fact]
    public void A_right_password_resets_the_count()
    {
        var hash = ExitPassword.Hash("sinf-2026!");
        var gate = new ExitGate();
        var now = DateTimeOffset.Parse("2026-11-20T10:00:00Z");
        for (var i = 0; i < ExitGate.MaxFailures - 1; i++) gate.TryOpen("wrong", hash, now);
        Assert.True(gate.TryOpen("sinf-2026!", hash, now));
        for (var i = 0; i < ExitGate.MaxFailures - 1; i++) gate.TryOpen("wrong", hash, now);
        Assert.Equal(TimeSpan.Zero, gate.Wait(now));
    }

    // Finding 4: the installer's password opens the kiosk too, before and after the teacher is met.
    [Fact]
    public void Either_the_room_password_or_the_installer_one_opens()
    {
        var room = ExitPassword.Hash("room-password-1");
        var installer = ExitPassword.Hash("installer-pass-2");
        var hashes = KioskPasswords.From(room, installer);
        var gate = new ExitGate();
        var now = DateTimeOffset.UnixEpoch;
        Assert.True(gate.TryOpen("room-password-1", hashes, now));
        Assert.True(gate.TryOpen("installer-pass-2", hashes, now));
        Assert.False(gate.TryOpen("something-else", hashes, now));
    }

    [Fact]
    public void Only_well_formed_hashes_count_and_each_once()
    {
        var installer = ExitPassword.Hash("installer-pass-2");
        Assert.Equal([installer], KioskPasswords.From(null, installer));
        Assert.Equal([installer], KioskPasswords.From("not a hash", installer));
        Assert.Equal([installer], KioskPasswords.From(installer, installer));
        Assert.Empty(KioskPasswords.From(null, null));
    }

    [Fact]
    public void No_password_at_all_opens_nothing_through_the_gate()
    {
        // The kiosk lets a computer that is still being set up out without asking; the gate itself
        // never opens on an empty list.
        Assert.False(new ExitGate().TryOpen("anything-at-all", Array.Empty<string>(), DateTimeOffset.UnixEpoch));
    }

    [Fact]
    public void Wrong_tries_against_several_passwords_still_pause_the_gate()
    {
        var hashes = KioskPasswords.From(ExitPassword.Hash("room-password-1"), ExitPassword.Hash("installer-pass-2"));
        var gate = new ExitGate();
        var now = DateTimeOffset.UnixEpoch;
        for (var i = 0; i < ExitGate.MaxFailures; i++)
        {
            Assert.False(gate.TryOpen("wrong", hashes, now));
        }

        Assert.False(gate.TryOpen("installer-pass-2", hashes, now.AddSeconds(30)));
        Assert.True(gate.TryOpen("installer-pass-2", hashes, now.AddMinutes(1)));
    }
}
