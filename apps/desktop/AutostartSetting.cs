using Microsoft.Win32;
using Sinf.Desktop.Core;

namespace Sinf.Desktop;

/// <summary>Turns the student computer's start with Windows on or off (stage 3, H7).</summary>
internal static class AutostartSetting
{
    public static void Apply(bool on)
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(Autostart.RunKey, writable: true);
            if (on)
            {
                key.SetValue(Autostart.ValueName, Autostart.CommandFor(Application.ExecutablePath));
            }
            else if (key.GetValue(Autostart.ValueName) is not null)
            {
                key.DeleteValue(Autostart.ValueName, throwOnMissingValue: false);
            }
        }
        catch (Exception error) when (error is UnauthorizedAccessException or System.Security.SecurityException or IOException)
        {
            // A locked-down profile: the computer simply does not start Sinf by itself.
        }
    }
}
