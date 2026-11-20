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
}
