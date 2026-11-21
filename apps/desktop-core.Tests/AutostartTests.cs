using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

public class AutostartTests
{
    [Fact]
    public void A_path_with_spaces_is_quoted()
    {
        Assert.Equal("\"C:\\Program Files\\Sinf\\Sinf.exe\"", Autostart.CommandFor("C:\\Program Files\\Sinf\\Sinf.exe"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("C:\\Sinf\\Sinf.exe\" --dev")]
    public void A_broken_path_is_refused(string path)
    {
        Assert.Throws<ArgumentException>(() => Autostart.CommandFor(path));
    }
}
