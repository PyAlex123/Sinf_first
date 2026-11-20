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

    /// <summary>Opens the program, or brings it to the front when it is already open.</summary>
    public static bool Launch(string id)
    {
        var spec = AppCatalog.Find(id);
        if (spec is null)
        {
            return false;
        }

        var running = Running(spec).FirstOrDefault(p => p.MainWindowHandle != IntPtr.Zero);
        if (running is not null)
        {
            ShowWindow(running.MainWindowHandle, SwRestore);
            SetForegroundWindow(running.MainWindowHandle);
            return true;
        }

        try
        {
            Process.Start(new ProcessStartInfo(spec.Command) { UseShellExecute = true })?.Dispose();
            return true;
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return false;
        }
    }

    public static bool AnyRunning() => Running().Any();

    /// <summary>Asks every practice program to close, which offers to save unsaved work.</summary>
    public static void AskToClose()
    {
        foreach (var process in Running())
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
    public static void CloseByForce()
    {
        foreach (var process in Running())
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
        var names = only?.ProcessNames ?? ["mspaint"];
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
