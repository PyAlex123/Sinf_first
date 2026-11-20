using System.Runtime.InteropServices;

namespace Sinf.Desktop;

/// <summary>
/// A Windows job object that kills everything inside it when the handle closes. The Node server is put in
/// one, so it cannot stay behind as an orphan process when our window closes — or when the app is killed
/// from Task Manager, which <c>Process.Kill</c> would never get the chance to handle.
/// </summary>
internal sealed class JobObject : IDisposable
{
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint LimitKillOnJobClose = 0x2000;

    private IntPtr handle;

    public JobObject()
    {
        handle = CreateJobObjectW(IntPtr.Zero, null);
        if (handle == IntPtr.Zero)
        {
            return;
        }

        var limits = new JobObjectExtendedLimitInformationData
        {
            BasicLimitInformation = { LimitFlags = LimitKillOnJobClose },
        };
        var size = Marshal.SizeOf<JobObjectExtendedLimitInformationData>();
        var buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(limits, buffer, fDeleteOld: false);
            SetInformationJobObject(handle, JobObjectExtendedLimitInformation, buffer, (uint)size);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    /// <summary>Adds a process to the job; returns false when the job could not be created or assigned.</summary>
    public bool Add(IntPtr processHandle)
    {
        return handle != IntPtr.Zero && AssignProcessToJobObject(handle, processHandle);
    }

    public void Dispose()
    {
        if (handle == IntPtr.Zero)
        {
            return;
        }

        CloseHandle(handle);
        handle = IntPtr.Zero;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObjectW(IntPtr attributes, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformationData
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }
}
