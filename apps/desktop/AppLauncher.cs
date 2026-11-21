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
        if (spec is null || !IsInstalled(spec))
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
            var start = new ProcessStartInfo(spec.Command) { UseShellExecute = true };
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
    /// programs under App Paths (HKLM, and HKCU for a per-user install).
    /// </summary>
    public static bool IsInstalled(AppSpec spec)
    {
        if (spec.AlwaysThere)
        {
            return true;
        }

        const string key = @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\";
        foreach (var root in new[] { Microsoft.Win32.Registry.LocalMachine, Microsoft.Win32.Registry.CurrentUser })
        {
            using var entry = root.OpenSubKey(key + spec.Command);
            if (entry?.GetValue(null) is string path && File.Exists(path.Trim('"')))
            {
                return true;
            }
        }

        return false;
    }

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
    public static bool OwnsForegroundWindow()
    {
        var window = GetForegroundWindow();
        if (window == IntPtr.Zero)
        {
            return false;
        }

        GetWindowThreadProcessId(window, out var pid);
        try
        {
            using var process = Process.GetProcessById((int)pid);
            return AppCatalog.IsPracticeProcess(process.ProcessName);
        }
        catch (ArgumentException)
        {
            return false;
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
