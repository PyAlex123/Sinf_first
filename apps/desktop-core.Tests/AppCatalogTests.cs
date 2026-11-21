using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

public class AppCatalogTests
{
    [Fact]
    public void Knows_the_lesson_programs_by_id_only()
    {
        Assert.Equal("mspaint.exe", AppCatalog.Find("paint")?.Command);
        Assert.Equal("winword.exe", AppCatalog.Find("word")?.Command);
        Assert.Equal(["paint", "notepad", "word", "excel", "powerpoint"], AppCatalog.All.Select(a => a.Id));
        Assert.True(AppCatalog.Find("notepad")?.AlwaysThere);
        Assert.False(AppCatalog.Find("excel")?.AlwaysThere);
        Assert.Null(AppCatalog.Find("cmd"));
        Assert.Null(AppCatalog.Find("explorer"));
        Assert.Null(AppCatalog.Find(@"C:\Windows\System32\cmd.exe"));
        Assert.Null(AppCatalog.Find("PAINT"));
        Assert.Null(AppCatalog.Find(null));
    }

    [Theory]
    [InlineData("mspaint", true)]
    [InlineData("MSPaint", true)]
    [InlineData("WINWORD", true)]
    [InlineData("powerpnt", true)]
    [InlineData("explorer", false)]
    [InlineData("cmd", false)]
    [InlineData(null, false)]
    public void Only_lesson_programs_may_take_the_focus(string? name, bool expected)
    {
        Assert.Equal(expected, AppCatalog.IsPracticeProcess(name));
    }

    [Fact]
    public void Closes_what_is_open_and_no_longer_allowed()
    {
        Assert.Equal(["word"], AppCatalog.ToClose(["paint"], ["paint", "word", "word"]).Select(a => a.Id));
        Assert.Empty(AppCatalog.ToClose(["paint", "word"], ["paint", "word"]));
        Assert.Equal(["paint"], AppCatalog.ToClose([], ["paint", "unknown"]).Select(a => a.Id));
    }
}
