using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Sinf.Desktop;

/// <summary>
/// "Attention!" on a classroom computer (stage 3, H4; CLAUDE.md §4.5): while it exists, no mouse
/// movement or click reaches any window. It is created when the teacher locks and disposed when the
/// teacher unlocks, so it costs nothing the rest of the lesson. `BlockInput` would need administrator
/// rights; a low-level hook does not.
/// </summary>
internal sealed class MouseGuard : IDisposable
{
    private const int WhMouseLl = 14;

    // Kept in a field: a collected delegate would crash the process at the next mouse move.
    private readonly LowLevelMouseProc proc;
    private readonly IntPtr hook;

    public MouseGuard()
    {
        proc = (code, message, data) => code >= 0 ? 1 : CallNextHookEx(IntPtr.Zero, code, message, data);
        using var process = Process.GetCurrentProcess();
        using var module = process.MainModule;
        hook = SetWindowsHookEx(WhMouseLl, proc, GetModuleHandle(module?.ModuleName), 0);
        if (hook == IntPtr.Zero)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Не удалось перехватить мышь.");
        }
    }

    public void Dispose()
    {
        UnhookWindowsHookEx(hook);
    }

    private delegate IntPtr LowLevelMouseProc(int code, IntPtr message, IntPtr data);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int hookId, LowLevelMouseProc proc, IntPtr module, uint threadId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? name);
}
