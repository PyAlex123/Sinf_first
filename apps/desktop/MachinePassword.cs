using Microsoft.Win32;
using Sinf.Desktop.Core;

namespace Sinf.Desktop;

/// <summary>
/// The exit password given to the installer (test finding 4), kept as a hash in
/// <c>HKLM\SOFTWARE\Sinf</c>: every user of the computer reads it, only an administrator changes it.
/// </summary>
internal static class MachinePassword
{
    public const string Flag = "--set-exit-password";

    public static string? Read()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(KioskPasswords.MachineKey);
            return key?.GetValue(KioskPasswords.MachineValue) as string;
        }
        catch (Exception error) when (error is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
            return null;
        }
    }

    /// <summary>The passwords that open this user's kiosk: the room's (H3) and the installer's.</summary>
    public static IReadOnlyList<string> KioskHashes(HostConfig config) =>
        KioskPasswords.From(config.ExitPasswordHash, Read());

    /// <summary>
    /// <c>Sinf.exe --set-exit-password</c>, run by the installer as administrator with the password in
    /// <see cref="KioskPasswords.InstallerVariable"/>. 0 — saved, 1 — not allowed, 2 — too short.
    /// </summary>
    public static int SetFromEnvironment()
    {
        var password = Environment.GetEnvironmentVariable(KioskPasswords.InstallerVariable);
        if (!ExitPassword.IsStrongEnough(password))
        {
            return 2;
        }

        try
        {
            using var key = Registry.LocalMachine.CreateSubKey(KioskPasswords.MachineKey, writable: true);
            key.SetValue(KioskPasswords.MachineValue, ExitPassword.Hash(password!));
            return 0;
        }
        catch (Exception error) when (error is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
            return 1;
        }
    }
}
