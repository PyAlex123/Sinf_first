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
        Assert.Equal(
            ["paint", "notepad", "word", "excel", "powerpoint", "scratch", "arduino", "python"],
            AppCatalog.All.Select(a => a.Id));
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
    [InlineData("Scratch 3", true)]
    [InlineData("Arduino IDE", true)]
    [InlineData("thonny", true)]
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

    private sealed class FakeComputer(params string[] files) : IAppEnvironment
    {
        public Dictionary<string, string> AppPaths { get; } = new(StringComparer.OrdinalIgnoreCase);

        public Dictionary<string, string> Variables { get; } = new()
        {
            ["ProgramFiles"] = @"C:\Program Files",
            ["ProgramFiles(x86)"] = @"C:\Program Files (x86)",
            ["LOCALAPPDATA"] = @"C:\Users\Ученик\AppData\Local",
        };

        public string? AppPath(string command) => AppPaths.GetValueOrDefault(command);

        public bool FileExists(string path) => files.Contains(path, StringComparer.OrdinalIgnoreCase);

        public string Expand(string path) =>
            Variables.Aggregate(path, (p, v) => p.Replace($"%{v.Key}%", v.Value, StringComparison.OrdinalIgnoreCase));

        public IEnumerable<string> Directories(string parent, string pattern)
        {
            var prefix = pattern.TrimEnd('*');
            return files
                .Select(f => Path.GetDirectoryName(f.Replace('\\', '/'))?.Replace('/', '\\') ?? "")
                .Where(d => d.StartsWith(parent + "\\" + prefix, StringComparison.OrdinalIgnoreCase)
                    && !d[(parent.Length + 1)..].Contains('\\'))
                .Distinct();
        }
    }

    private static AppSpec Spec(string id) => AppCatalog.Find(id)!;

    [Fact]
    public void Windows_programs_are_always_there_and_office_only_when_registered()
    {
        var bare = new FakeComputer();
        Assert.Equal("mspaint.exe", AppCatalog.Locate(Spec("paint"), bare)?.Exe);
        Assert.Null(AppCatalog.Locate(Spec("word"), bare));

        var office = new FakeComputer(@"C:\Office\WINWORD.EXE");
        office.AppPaths["winword.exe"] = @"""C:\Office\WINWORD.EXE""";
        Assert.Equal(new LocatedApp("winword.exe", []), AppCatalog.Locate(Spec("word"), office));

        // A stale registration of an uninstalled Office is not a program.
        var stale = new FakeComputer();
        stale.AppPaths["winword.exe"] = @"C:\Office\WINWORD.EXE";
        Assert.Null(AppCatalog.Locate(Spec("word"), stale));
    }

    [Fact]
    public void Finds_scratch_and_arduino_where_they_install()
    {
        Assert.Null(AppCatalog.Locate(Spec("scratch"), new FakeComputer()));
        Assert.Equal(
            @"C:\Program Files (x86)\Scratch 3\Scratch 3.exe",
            AppCatalog.Locate(Spec("scratch"), new FakeComputer(@"C:\Program Files (x86)\Scratch 3\Scratch 3.exe"))?.Exe);

        // The new IDE is preferred to the old one when both are there.
        var both = new FakeComputer(
            @"C:\Program Files (x86)\Arduino\arduino.exe",
            @"C:\Program Files\Arduino IDE\Arduino IDE.exe");
        Assert.Equal(@"C:\Program Files\Arduino IDE\Arduino IDE.exe", AppCatalog.Locate(Spec("arduino"), both)?.Exe);
        Assert.Equal(
            @"C:\Program Files (x86)\Arduino\arduino.exe",
            AppCatalog.Locate(Spec("arduino"), new FakeComputer(@"C:\Program Files (x86)\Arduino\arduino.exe"))?.Exe);
    }

    [Fact]
    public void Python_is_thonny_or_else_idle_of_the_newest_python()
    {
        var thonny = new FakeComputer(@"C:\Program Files (x86)\Thonny\thonny.exe", @"C:\Program Files\Python312\pythonw.exe");
        Assert.Equal(new LocatedApp(@"C:\Program Files (x86)\Thonny\thonny.exe", []), AppCatalog.Locate(Spec("python"), thonny));

        var pythons = new FakeComputer(
            @"C:\Program Files\Python39\pythonw.exe",
            @"C:\Program Files\Python313\pythonw.exe",
            @"C:\Program Files\Python311\python.exe");
        var idle = AppCatalog.Locate(Spec("python"), pythons);
        Assert.Equal(@"C:\Program Files\Python313\pythonw.exe", idle?.Exe);
        Assert.Equal(["-m", "idlelib"], idle?.Args);
    }

    [Fact]
    public void A_variable_the_computer_lacks_is_not_a_path()
    {
        var x86 = new FakeComputer(@"%ProgramFiles(x86)%\Thonny\thonny.exe");
        x86.Variables.Remove("ProgramFiles(x86)");
        Assert.Null(AppCatalog.Locate(Spec("python"), x86));
    }
}
