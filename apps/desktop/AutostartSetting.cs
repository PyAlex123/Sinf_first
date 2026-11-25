using Microsoft.Win32;
using Sinf.Desktop.Core;

namespace Sinf.Desktop;

/// <summary>
/// Sinf's own start with Windows, as earlier versions kept it for each user (stage 3, H7). Whether a
/// student computer starts Sinf with Windows is now asked by the installer, off by default (test
/// finding 5: the author's laptop opened the kiosk at every start and had to be rescued in Safe
/// Mode). The app only removes the entry an older version left behind.
/// </summary>
internal static class AutostartSetting
{
    public static void RemoveUserEntry()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(Autostart.RunKey, writable: true);
            if (key?.GetValue(Autostart.ValueName) is not null)
            {
                key.DeleteValue(Autostart.ValueName, throwOnMissingValue: false);
            }
        }
        catch (Exception error) when (error is UnauthorizedAccessException or System.Security.SecurityException or IOException)
        {
            // A locked-down profile: nothing of ours can be there either.
        }
    }
}
