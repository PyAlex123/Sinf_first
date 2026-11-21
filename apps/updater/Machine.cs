using System.Diagnostics;
using Microsoft.Win32;
using Sinf.Desktop.Core;
using Activity = Sinf.Desktop.Core.Activity;

namespace Sinf.Updater;

/// <summary>What the updater reads from this computer: the installed version and Sinf's marks.</summary>
internal static class Machine
{
    /// <summary>The installer's AppId (tools/installer/sinf.iss): its uninstall entry has the version.</summary>
    private const string UninstallKey =
        @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{5E7C3B1A-9D2F-4C8E-A6B4-3F1D2E9C7A50}_is1";

    /// <summary>What the installer says it put here; else Sinf.exe's own version.</summary>
    public static string InstalledVersion(string app)
    {
        using (var key = Registry.LocalMachine.OpenSubKey(UninstallKey))
        {
            if (key?.GetValue("DisplayVersion") is string version && !string.IsNullOrWhiteSpace(version))
            {
                return version.Trim();
            }
        }

        var exe = Path.Combine(app, "Sinf.exe");
        return File.Exists(exe) ? FileVersionInfo.GetVersionInfo(exe).FileVersion ?? "0" : "0";
    }

    /// <summary>
    /// Every user's <c>%LOCALAPPDATA%\Sinf\activity.json</c>: the teacher's and the "Ученик" account's
    /// alike. Profiles are taken from the registry, where Windows lists them wherever they live.
    /// </summary>
    public static IReadOnlyList<Activity> Activities()
    {
        var found = new List<Activity>();
        using var profiles = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList");
        foreach (var sid in profiles?.GetSubKeyNames() ?? [])
        {
            using var profile = profiles?.OpenSubKey(sid);
            if (profile?.GetValue("ProfileImagePath") is not string raw)
            {
                continue;
            }

            var file = Path.Combine(Environment.ExpandEnvironmentVariables(raw), "AppData", "Local", "Sinf", "activity.json");
            try
            {
                if (File.Exists(file) && Updates.ParseActivity(File.ReadAllText(file)) is { } activity)
                {
                    found.Add(activity);
                }
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                // Being written right now; the next run reads it.
            }
        }

        return found;
    }
}

/// <summary>The updater's diary in <c>{app}\updates\updater.log</c>; the author reads it on a test PC.</summary>
internal sealed class Log(string file, bool echo)
{
    private const long MaxBytes = 512 * 1024;

    public void Write(string line)
    {
        var text = $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss} {line}";
        if (echo)
        {
            Console.WriteLine(text);
        }

        try
        {
            if (File.Exists(file) && new FileInfo(file).Length > MaxBytes)
            {
                File.Move(file, file + ".old", overwrite: true);
            }

            File.AppendAllText(file, text + Environment.NewLine);
        }
        catch (IOException)
        {
            // A diary that cannot be written is no reason to stop updating.
        }
    }
}
