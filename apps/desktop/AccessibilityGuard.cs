using System.Runtime.InteropServices;

namespace Sinf.Desktop;

/// <summary>
/// Five presses of Shift, holding Shift for eight seconds and holding NumLock for five each open a
/// Windows dialog with a link to Settings — a way out of the kiosk (PLAN.md 0.2). While the kiosk
/// runs, these hot keys are switched off for this user; on exit the old settings come back. Nothing is
/// written to the profile (no SPIF_UPDATEINIFILE), so a crash cannot leave them off for good.
/// </summary>
internal sealed class AccessibilityGuard : IDisposable
{
    private const uint SpiGetFilterKeys = 0x0032;
    private const uint SpiSetFilterKeys = 0x0033;
    private const uint SpiGetToggleKeys = 0x0034;
    private const uint SpiSetToggleKeys = 0x0035;
    private const uint SpiGetStickyKeys = 0x003A;
    private const uint SpiSetStickyKeys = 0x003B;

    // Same bit values for all three: the feature is on / its hot key is active / it asks first.
    private const uint FeatureOn = 0x1;
    private const uint HotKeyActive = 0x4;
    private const uint ConfirmHotKey = 0x8;

    private readonly Flags sticky;
    private readonly Flags toggle;
    private readonly FilterKeys filter;

    public AccessibilityGuard()
    {
        sticky = Read<Flags>(SpiGetStickyKeys);
        toggle = Read<Flags>(SpiGetToggleKeys);
        filter = Read<FilterKeys>(SpiGetFilterKeys);
        // A child who really uses one of these keeps it; only the hot key that opens the dialog goes.
        if ((sticky.DwFlags & FeatureOn) == 0)
        {
            Write(SpiSetStickyKeys, sticky with { DwFlags = sticky.DwFlags & ~(HotKeyActive | ConfirmHotKey) });
        }

        if ((toggle.DwFlags & FeatureOn) == 0)
        {
            Write(SpiSetToggleKeys, toggle with { DwFlags = toggle.DwFlags & ~(HotKeyActive | ConfirmHotKey) });
        }

        if ((filter.DwFlags & FeatureOn) == 0)
        {
            Write(SpiSetFilterKeys, filter with { DwFlags = filter.DwFlags & ~(HotKeyActive | ConfirmHotKey) });
        }
    }

    public void Dispose()
    {
        Write(SpiSetStickyKeys, sticky);
        Write(SpiSetToggleKeys, toggle);
        Write(SpiSetFilterKeys, filter);
    }

    private static T Read<T>(uint action)
        where T : struct
    {
        var size = (uint)Marshal.SizeOf<T>();
        var buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            Marshal.WriteInt32(buffer, (int)size);
            SystemParametersInfo(action, size, buffer, 0);
            return Marshal.PtrToStructure<T>(buffer);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static void Write<T>(uint action, T value)
        where T : struct
    {
        var size = (uint)Marshal.SizeOf<T>();
        var buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            Marshal.StructureToPtr(value, buffer, false);
            Marshal.WriteInt32(buffer, (int)size);
            SystemParametersInfo(action, size, buffer, 0);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    /// <summary>STICKYKEYS and TOGGLEKEYS share this layout.</summary>
    [StructLayout(LayoutKind.Sequential)]
    private record struct Flags(uint CbSize, uint DwFlags);

    [StructLayout(LayoutKind.Sequential)]
    private record struct FilterKeys(uint CbSize, uint DwFlags, uint IWaitMSec, uint IDelayMSec, uint IRepeatMSec, uint IBounceMSec);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SystemParametersInfo(uint action, uint param, IntPtr value, uint winIni);
}
