using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

public class PcNameTests
{
    [Theory]
    [InlineData("ПК-05", "ПК-05")]
    [InlineData("  ПК   05 ", "ПК 05")]
    public void Keeps_a_short_tidy_name(string input, string expected)
    {
        Assert.True(PcName.TryNormalize(input, out var name));
        Assert.Equal(expected, name);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("слишком длинное имя компьютера")]
    public void Refuses_empty_or_long_names(string input)
    {
        Assert.False(PcName.TryNormalize(input, out _));
    }
}
