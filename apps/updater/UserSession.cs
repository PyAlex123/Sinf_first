using System.ComponentModel;
using System.Runtime.InteropServices;

namespace Sinf.Windows;

/// <summary>
/// Starting a program on a user's desktop from a SYSTEM process (B6; the agent of B7 too): the
/// updater runs outside every session, and Sinf must come back where the teacher or the child sees
/// it. The user's own token (WTSQueryUserToken, allowed to SYSTEM only) and environment are used,
/// so the program runs as that user, not as SYSTEM.
/// </summary>
internal static class UserSession
{
    /// <summary>Starts <paramref name="exe"/> in the session; false when nobody is logged on there.</summary>
    public static bool Start(string exe, int sessionId, string? arguments = null)
    {
        if (!WTSQueryUserToken((uint)sessionId, out var token))
        {
            return false;
        }

        var environment = IntPtr.Zero;
        try
        {
            if (!CreateEnvironmentBlock(out environment, token, false))
            {
                environment = IntPtr.Zero;
            }

            var startup = new StartupInfo { Size = Marshal.SizeOf<StartupInfo>(), Desktop = @"winsta0\default" };
            var commandLine = $"\"{exe}\"" + (string.IsNullOrEmpty(arguments) ? string.Empty : " " + arguments);
            if (!CreateProcessAsUser(
                    token,
                    exe,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    false,
                    CreateUnicodeEnvironment,
                    environment,
                    Path.GetDirectoryName(exe),
                    ref startup,
                    out var process))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            CloseHandle(process.Process);
            CloseHandle(process.Thread);
            return true;
        }
        finally
        {
            if (environment != IntPtr.Zero)
            {
                DestroyEnvironmentBlock(environment);
            }

            CloseHandle(token);
        }
    }

    /// <summary>The session someone sits at: the physical console.</summary>
    public static int ConsoleSession() => (int)WTSGetActiveConsoleSessionId();

    private const uint CreateUnicodeEnvironment = 0x00000400;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Size;
        public string? Reserved;
        public string? Desktop;
        public string? Title;
        public int X;
        public int Y;
        public int XSize;
        public int YSize;
        public int XCountChars;
        public int YCountChars;
        public int FillAttribute;
        public int Flags;
        public short ShowWindow;
        public short Reserved2;
        public IntPtr Reserved2Pointer;
        public IntPtr StdInput;
        public IntPtr StdOutput;
        public IntPtr StdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr Process;
        public IntPtr Thread;
        public int ProcessId;
        public int ThreadId;
    }

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSQueryUserToken(uint sessionId, out IntPtr token);

    [DllImport("kernel32.dll")]
    private static extern uint WTSGetActiveConsoleSessionId();

    [DllImport("userenv.dll", SetLastError = true)]
    private static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token, bool inherit);

    [DllImport("userenv.dll", SetLastError = true)]
    private static extern bool DestroyEnvironmentBlock(IntPtr environment);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessAsUser(
        IntPtr token,
        string application,
        string commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string? currentDirectory,
        ref StartupInfo startupInfo,
        out ProcessInformation processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
}
