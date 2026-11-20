using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

public class AppCatalogTests
{
    [Fact]
    public void Paint_is_the_only_program_for_now()
    {
        Assert.Equal("mspaint.exe", AppCatalog.Find("paint")?.Command);
        Assert.Null(AppCatalog.Find("cmd"));
        Assert.Null(AppCatalog.Find("explorer"));
        Assert.Null(AppCatalog.Find("PAINT"));
        Assert.Null(AppCatalog.Find(null));
    }

    [Theory]
    [InlineData("mspaint", true)]
    [InlineData("MSPaint", true)]
    [InlineData("explorer", false)]
    [InlineData("cmd", false)]
    [InlineData(null, false)]
    public void Only_practice_programs_may_take_the_focus(string? name, bool expected)
    {
        Assert.Equal(expected, AppCatalog.IsPracticeProcess(name));
    }
}
