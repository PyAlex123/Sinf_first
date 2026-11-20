using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Sinf.Desktop.Core;

namespace Sinf.Desktop;

/// <summary>
/// The low-level keyboard hook of a student's kiosk (stage 3, H3; CLAUDE.md §8). It sees every key
/// before Windows does and asks <see cref="KeyRules"/> what to do. It cannot see Ctrl+Alt+Del or
/// Win+L: those belong to Windows itself and are closed by the agent's policies (6.4).
/// </summary>
internal sealed class KeyboardGuard : IDisposable
{
    private const int WhKeyboardLl = 13;
    private const int WmKeyDown = 0x0100;
    private const int WmKeyUp = 0x0101;
    private const int WmSysKeyDown = 0x0104;
    private const int WmSysKeyUp = 0x0105;
    private const int LlkhfAltDown = 0x20;
    private const int VkShift = 0x10;
    private const int VkControl = 0x11;

    private readonly Action askPassword;
    // Kept in a field: a collected delegate would crash the process the next time a key is pressed.
    private readonly LowLevelKeyboardProc proc;
    private readonly IntPtr hook;
    private bool winDown;
    private readonly HashSet<int> swallowedDown = [];

    /// <param name="askPassword">Called on the UI thread's message loop when the exit combination is pressed.</param>
    public KeyboardGuard(Action askPassword)
    {
        this.askPassword = askPassword;
        proc = HookProc;
        using var process = Process.GetCurrentProcess();
        using var module = process.MainModule;
        hook = SetWindowsHookEx(WhKeyboardLl, proc, GetModuleHandle(module?.ModuleName), 0);
        if (hook == IntPtr.Zero)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Не удалось перехватить клавиатуру.");
        }
    }

    private IntPtr HookProc(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            var info = Marshal.PtrToStructure<KbdLlHookStruct>(data);
            var key = (int)info.VkCode;
            var kind = (int)message;
            var down = kind is WmKeyDown or WmSysKeyDown;
            var up = kind is WmKeyUp or WmSysKeyUp;

            if (key is KeyRules.LeftWin or KeyRules.RightWin)
            {
                winDown = down;
            }

            if (down)
            {
                var decision = KeyRules.Decide(
                    key,
                    ctrl: IsPressed(VkControl),
                    alt: (info.Flags & LlkhfAltDown) != 0,
                    shift: IsPressed(VkShift),
                    win: winDown);
                if (decision == KeyDecision.AskPassword)
                {
                    askPassword();
                }

                if (decision != KeyDecision.Pass)
                {
                    swallowedDown.Add(key);
                    return 1;
                }
            }
            else if (up && swallowedDown.Remove(key))
            {
                // The release of a swallowed key is swallowed too, or Windows would act on it (Win opens Start on release).
                return 1;
            }
        }

        return CallNextHookEx(hook, code, message, data);
    }

    private static bool IsPressed(int key) => (GetAsyncKeyState(key) & 0x8000) != 0;

    public void Dispose()
    {
        UnhookWindowsHookEx(hook);
    }

    private delegate IntPtr LowLevelKeyboardProc(int code, IntPtr message, IntPtr data);

    [StructLayout(LayoutKind.Sequential)]
    private struct KbdLlHookStruct
    {
        public uint VkCode;
        public uint ScanCode;
        public int Flags;
        public uint Time;
        public IntPtr ExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int hookId, LowLevelKeyboardProc proc, IntPtr module, uint threadId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int key);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? name);
}
