using System.Diagnostics;
using System.Runtime.InteropServices;
using Sinf.Desktop.Core;

namespace Sinf.Desktop;

/// <summary>
/// Opens and closes the practice's programs (stage 3, H6). Only what <see cref="AppCatalog"/> lists.
/// Programs are recognised by process name rather than by the process started: on Windows 11 Paint
/// is a Store app, and the process `mspaint.exe` launches is not the one that stays.
/// </summary>
internal static class AppLauncher
{
    private const int SwRestore = 9;

    /// <summary>
    /// Opens the program, or brings it to the front when it is already open. With a file — a path in
    /// the lesson's working folder, checked by the caller — the program opens it.
    /// </summary>
    public static bool Launch(string id, string? file = null)
    {
        var spec = AppCatalog.Find(id);
        var located = spec is null ? null : AppCatalog.Locate(spec, WindowsAppEnvironment.Instance);
        if (spec is null || located is null)
        {
            return false;
        }

        var running = Running(spec).FirstOrDefault(p => p.MainWindowHandle != IntPtr.Zero);
        if (running is not null && file is null)
        {
            ShowWindow(running.MainWindowHandle, SwRestore);
            SetForegroundWindow(running.MainWindowHandle);
            return true;
        }

        try
        {
            var start = new ProcessStartInfo(located.Exe) { UseShellExecute = true };
            foreach (var arg in located.Args)
            {
                start.ArgumentList.Add(arg);
            }

            if (file is not null)
            {
                start.ArgumentList.Add(file);
            }

            Process.Start(start)?.Dispose();
            return true;
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return false;
        }
    }

    /// <summary>
    /// Is the program on this computer? Paint and Notepad are part of Windows; Office registers its
    /// programs under App Paths; Scratch, Arduino and Python are looked for where they install (B5).
    /// </summary>
    public static bool IsInstalled(AppSpec spec) => AppCatalog.Locate(spec, WindowsAppEnvironment.Instance) is not null;

    /// <summary>The ids of the catalog's programs found on this computer.</summary>
    public static IReadOnlyList<string> Installed() =>
        AppCatalog.All.Where(IsInstalled).Select(a => a.Id).ToList();

    /// <summary>The ids of the catalog's programs that are open now.</summary>
    public static IReadOnlyList<string> RunningIds() =>
        AppCatalog.All.Where(a => Running(a).Any()).Select(a => a.Id).ToList();

    public static bool AnyRunning() => Running().Any();

    /// <summary>Asks the lesson's programs to close — all, or only these — which offers to save unsaved work.</summary>
    public static void AskToClose(IEnumerable<AppSpec>? only = null)
    {
        foreach (var process in only is null ? Running() : only.SelectMany(Running))
        {
            try
            {
                process.CloseMainWindow();
            }
            catch (InvalidOperationException)
            {
                // Already gone.
            }
        }
    }

    /// <summary>The grace is over: whatever is still open is closed.</summary>
    public static void CloseByForce(IEnumerable<AppSpec>? only = null)
    {
        foreach (var process in only is null ? Running() : only.SelectMany(Running))
        {
            try
            {
                process.Kill();
            }
            catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception)
            {
                // Gone already, or not ours to stop.
            }
        }
    }

    /// <summary>Does this window belong to a practice program? Only those may take the focus from the lesson.</summary>
    public static bool OwnsForegroundWindow() =>
        ForegroundProcessName() is { } name && AppCatalog.IsPracticeProcess(name);

    /// <summary>
    /// Windows' own Task Manager is in front (finding 3). Without the agent nothing forbids it, and the
    /// kiosk must not take the focus from it; with the agent a policy does not let it open at all.
    /// </summary>
    public static bool TaskManagerInFront() =>
        string.Equals(ForegroundProcessName(), "Taskmgr", StringComparison.OrdinalIgnoreCase);

    private static string? ForegroundProcessName()
    {
        var window = GetForegroundWindow();
        if (window == IntPtr.Zero)
        {
            return null;
        }

        GetWindowThreadProcessId(window, out var pid);
        try
        {
            using var process = Process.GetProcessById((int)pid);
            return process.ProcessName;
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException)
        {
            return null;
        }
    }

    private static IEnumerable<Process> Running(AppSpec? only = null)
    {
        var names = only?.ProcessNames ?? AppCatalog.ProcessNames;
        return names.SelectMany(Process.GetProcessesByName);
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr window, int command);
}

/// <summary>The catalog's view of this Windows computer: App Paths in the registry, files and folders.</summary>
internal sealed class WindowsAppEnvironment : IAppEnvironment
{
    public static readonly WindowsAppEnvironment Instance = new();

    public string? AppPath(string command)
    {
        const string key = @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\";
        foreach (var root in new[] { Microsoft.Win32.Registry.LocalMachine, Microsoft.Win32.Registry.CurrentUser })
        {
            using var entry = root.OpenSubKey(key + command);
            if (entry?.GetValue(null) is string path)
            {
                return path;
            }
        }

        return null;
    }

    public bool FileExists(string path) => File.Exists(path);

    public string Expand(string path) => Environment.ExpandEnvironmentVariables(path);

    public IEnumerable<string> Directories(string parent, string pattern)
    {
        try
        {
            return Directory.Exists(parent) ? Directory.GetDirectories(parent, pattern) : [];
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return [];
        }
    }
}
