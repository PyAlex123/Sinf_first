namespace Sinf.Desktop.Core;

/// <summary>A program a lesson may open (stage 3, H6 and H15; CLAUDE.md §4.7, §6 ApprovedApp).</summary>
/// <param name="Id">What the lesson page asks for: "paint", "word".</param>
/// <param name="Command">What Windows starts: an App Paths name, so the right program opens on Windows 10 and 11.</param>
/// <param name="ProcessNames">How its process is recognised, to give it the focus and to close it.</param>
/// <param name="AlwaysThere">Part of Windows itself; the others are found on the computer first.</param>
public sealed record AppSpec(string Id, string Command, IReadOnlyList<string> ProcessNames, bool AlwaysThere = false);

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
    ];

    public static AppSpec? Find(string? id) =>
        All.FirstOrDefault(a => string.Equals(a.Id, id, StringComparison.Ordinal));

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
