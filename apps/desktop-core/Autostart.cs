namespace Sinf.Desktop.Core;

/// <summary>
/// A student's computer opens Sinf when Windows starts (stage 3, H7): the classroom is ready before
/// the teacher walks in. It is the user's own "Run" list, so no administrator rights are needed.
/// </summary>
public static class Autostart
{
    /// <summary>The value name in HKCU\Software\Microsoft\Windows\CurrentVersion\Run.</summary>
    public const string ValueName = "Sinf";

    public const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    /// <summary>The command line Windows runs: the path quoted, since it may hold spaces.</summary>
    public static string CommandFor(string exePath)
    {
        if (string.IsNullOrWhiteSpace(exePath) || exePath.Contains('"', StringComparison.Ordinal))
        {
            throw new ArgumentException("A real program path is needed.", nameof(exePath));
        }

        return $"\"{exePath}\"";
    }
}
