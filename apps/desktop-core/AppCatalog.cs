namespace Sinf.Desktop.Core;

/// <summary>A program a lesson may open (stage 3, H6 and H15; CLAUDE.md §4.7, §6 ApprovedApp).</summary>
/// <param name="Id">What the lesson page asks for: "paint", "word".</param>
/// <param name="Command">What Windows starts: an App Paths name, so the right program opens on Windows 10 and 11.</param>
/// <param name="ProcessNames">How its process is recognised, to give it the focus and to close it.</param>
/// <param name="AlwaysThere">Part of Windows itself; the others are found on the computer first.</param>
/// <param name="Locations">Where to look when App Paths does not know the program (stage 6, B5).</param>
public sealed record AppSpec(
    string Id,
    string Command,
    IReadOnlyList<string> ProcessNames,
    bool AlwaysThere = false,
    IReadOnlyList<AppLocation>? Locations = null);

/// <summary>
/// A place a program is usually installed: environment variables in <c>%…%</c>, at most one folder
/// name with a <c>*</c> ("Python3*"), and the words that go before the file ("-m idlelib").
/// </summary>
public sealed record AppLocation(string Path, IReadOnlyList<string>? Args = null);

/// <summary>What to start: a program found on this computer and the words before the file.</summary>
public sealed record LocatedApp(string Exe, IReadOnlyList<string> Args);

/// <summary>The computer as the catalog sees it; the Windows one reads the registry and the disk.</summary>
public interface IAppEnvironment
{
    /// <summary>The program's path registered under App Paths (HKLM or HKCU), or null.</summary>
    string? AppPath(string command);

    bool FileExists(string path);

    string Expand(string path);

    IEnumerable<string> Directories(string parent, string pattern);
}

/// <summary>
/// The programs a lesson may open (H15). Only ids travel over the network — never paths: a teacher's
/// computer, or one pretending to be it, cannot make a student computer start anything outside this
/// list. Office is used only where it is installed; the school's own list (ApprovedApp) comes with
/// the agent and the school's settings.
/// </summary>
public static class AppCatalog
{
    /// <summary>How long a program has to answer "save your work?" before it is closed by force.</summary>
    public static readonly TimeSpan CloseGrace = TimeSpan.FromSeconds(30);

    public static IReadOnlyList<AppSpec> All { get; } =
    [
        new("paint", "mspaint.exe", ["mspaint"], AlwaysThere: true),
        new("notepad", "notepad.exe", ["notepad"], AlwaysThere: true),
        new("word", "winword.exe", ["WINWORD"]),
        new("excel", "excel.exe", ["EXCEL"]),
        new("powerpoint", "powerpnt.exe", ["POWERPNT"]),
        // Stage 6, B5. Installed "for all users" so that the student account finds them too.
        new("scratch", "Scratch 3.exe", ["Scratch 3"], Locations:
        [
            new(@"%ProgramFiles%\Scratch 3\Scratch 3.exe"),
            new(@"%ProgramFiles(x86)%\Scratch 3\Scratch 3.exe"),
            new(@"%LOCALAPPDATA%\Programs\Scratch 3\Scratch 3.exe"),
        ]),
        new("arduino", "Arduino IDE.exe", ["Arduino IDE", "arduino"], Locations:
        [
            new(@"%ProgramFiles%\Arduino IDE\Arduino IDE.exe"),
            new(@"%LOCALAPPDATA%\Programs\Arduino IDE\Arduino IDE.exe"),
            new(@"%ProgramFiles(x86)%\Arduino\arduino.exe"),
            new(@"%ProgramFiles%\Arduino\arduino.exe"),
        ]),
        // Thonny, the editor made for learning; without it, IDLE of an installed Python.
        new("python", "thonny.exe", ["thonny", "pythonw"], Locations:
        [
            new(@"%ProgramFiles(x86)%\Thonny\thonny.exe"),
            new(@"%ProgramFiles%\Thonny\thonny.exe"),
            new(@"%LOCALAPPDATA%\Programs\Thonny\thonny.exe"),
            new(@"%ProgramFiles%\Python3*\pythonw.exe", ["-m", "idlelib"]),
            new(@"%LOCALAPPDATA%\Programs\Python\Python3*\pythonw.exe", ["-m", "idlelib"]),
        ]),
    ];

    public static AppSpec? Find(string? id) =>
        All.FirstOrDefault(a => string.Equals(a.Id, id, StringComparison.Ordinal));

    /// <summary>
    /// Where the program is on this computer, or null when it is not installed. Part of Windows: its
    /// name. Registered under App Paths: its name too, Windows finds it. Otherwise the usual places,
    /// in order; with a <c>*</c> the newest version first ("Python313" before "Python39").
    /// </summary>
    public static LocatedApp? Locate(AppSpec spec, IAppEnvironment env)
    {
        if (spec.AlwaysThere)
        {
            return new LocatedApp(spec.Command, []);
        }

        var registered = env.AppPath(spec.Command);
        if (registered is not null && env.FileExists(registered.Trim('"')))
        {
            return new LocatedApp(spec.Command, []);
        }

        foreach (var location in spec.Locations ?? [])
        {
            foreach (var path in Candidates(env.Expand(location.Path), env))
            {
                if (env.FileExists(path))
                {
                    return new LocatedApp(path, location.Args ?? []);
                }
            }
        }

        return null;
    }

    private static IEnumerable<string> Candidates(string path, IAppEnvironment env)
    {
        // A variable this computer does not have ("%ProgramFiles(x86)%" on 32-bit Windows) stays as it is.
        if (path.Contains('%'))
        {
            yield break;
        }

        var parts = path.Split('\\');
        var star = Array.FindIndex(parts, p => p.Contains('*'));
        if (star < 0)
        {
            yield return path;
            yield break;
        }

        var parent = string.Join('\\', parts.Take(star));
        var rest = string.Join('\\', parts.Skip(star + 1));
        var found = env.Directories(parent, parts[star])
            .Select(d => d.TrimEnd('\\'))
            .OrderByDescending(d => d.Length)
            .ThenByDescending(d => d, StringComparer.OrdinalIgnoreCase);
        foreach (var dir in found)
        {
            yield return rest.Length > 0 ? dir + '\\' + rest : dir;
        }
    }

    /// <summary>Is a process with this name one of the lesson's programs?</summary>
    public static bool IsPracticeProcess(string? processName) =>
        processName is not null
        && All.Any(a => a.ProcessNames.Contains(processName, StringComparer.OrdinalIgnoreCase));

    /// <summary>Every process name of the catalog, for finding what is open.</summary>
    public static IEnumerable<string> ProcessNames => All.SelectMany(a => a.ProcessNames);

    /// <summary>
    /// The programs allowed now that are open and must close: everything of the catalog not in
    /// <paramref name="allowed"/>.
    /// </summary>
    public static IReadOnlyList<AppSpec> ToClose(IEnumerable<string> allowed, IEnumerable<string> runningIds)
    {
        var keep = allowed.ToHashSet(StringComparer.Ordinal);
        return runningIds.Distinct().Where(id => !keep.Contains(id)).Select(Find).OfType<AppSpec>().ToList();
    }
}
