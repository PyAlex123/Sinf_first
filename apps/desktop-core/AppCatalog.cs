namespace Sinf.Desktop.Core;

/// <summary>A program a practice may open (stage 3, H6; CLAUDE.md §4.7, §6 ApprovedApp).</summary>
/// <param name="Id">What the lesson page asks for: "paint".</param>
/// <param name="Command">What Windows starts: an App Paths name, so the right Paint opens on Windows 10 and 11.</param>
/// <param name="ProcessNames">How its process is recognised, to give it the focus and to close it.</param>
public sealed record AppSpec(string Id, string Command, IReadOnlyList<string> ProcessNames);

/// <summary>
/// The white list of programs for now: Paint only — the practice of the club lessons. The school's own
/// list (ApprovedApp) comes with the agent and the school's settings; until then nothing else opens.
/// </summary>
public static class AppCatalog
{
    /// <summary>How long a program has to answer "save your work?" before it is closed by force.</summary>
    public static readonly TimeSpan CloseGrace = TimeSpan.FromSeconds(30);

    private static readonly AppSpec[] Apps =
    [
        new("paint", "mspaint.exe", ["mspaint"]),
    ];

    public static AppSpec? Find(string? id) =>
        Apps.FirstOrDefault(a => string.Equals(a.Id, id, StringComparison.Ordinal));

    /// <summary>Is a process with this name one of the practice's programs?</summary>
    public static bool IsPracticeProcess(string? processName) =>
        processName is not null
        && Apps.Any(a => a.ProcessNames.Contains(processName, StringComparer.OrdinalIgnoreCase));
}
