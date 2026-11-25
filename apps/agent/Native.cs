using System.ComponentModel;
using System.Runtime.InteropServices;

namespace Sinf.Agent;

/// <summary>
/// The Windows calls the agent needs and .NET does not wrap: local accounts, the LSA secret of
/// autologon, profiles and loading another user's registry hive.
/// </summary>
internal static class Native
{
    private const int NerrSuccess = 0;
    private const int NerrUserExists = 2224;
    private const int NerrUserNotFound = 2221;
    private const int ErrorMemberInAlias = 1378;
    private const uint UserPrivUser = 1;
    private const uint UfScript = 0x0001;
    private const uint UfPasswdCantChange = 0x0040;
    private const uint UfDontExpirePasswd = 0x10000;

    /// <summary>Creates the account; false when it already existed (then only the password is set).</summary>
    public static bool CreateOrResetUser(string name, string password, string comment)
    {
        var info = new UserInfo1
        {
            Name = name,
            Password = password,
            Privilege = UserPrivUser,
            Comment = comment,
            Flags = UfScript | UfPasswdCantChange | UfDontExpirePasswd,
        };
        var code = NetUserAdd(null, 1, ref info, out _);
        if (code == NerrSuccess)
        {
            return true;
        }

        if (code != NerrUserExists)
        {
            throw new Win32Exception(code, $"NetUserAdd {name}");
        }

        var reset = new UserInfo1003 { Password = password };
        code = NetUserSetInfo(null, name, 1003, ref reset, out _);
        if (code != NerrSuccess)
        {
            throw new Win32Exception(code, $"NetUserSetInfo {name}");
        }

        return false;
    }

    public static void AddToGroup(string group, string user)
    {
        var member = new LocalGroupMembersInfo3 { DomainAndName = user };
        var code = NetLocalGroupAddMembers(null, group, 3, ref member, 1);
        if (code != NerrSuccess && code != ErrorMemberInAlias)
        {
            throw new Win32Exception(code, $"NetLocalGroupAddMembers {group}");
        }
    }

    public static bool UserExists(string name)
    {
        var code = NetUserGetInfo(null, name, 0, out var buffer);
        if (buffer != IntPtr.Zero)
        {
            NetApiBufferFree(buffer);
        }

        return code == NerrSuccess;
    }

    public static void DeleteUser(string name)
    {
        var code = NetUserDel(null, name);
        if (code != NerrSuccess && code != NerrUserNotFound)
        {
            throw new Win32Exception(code, $"NetUserDel {name}");
        }
    }

    /// <summary>The autologon password, kept where Windows reads it and nobody else can: an LSA secret.</summary>
    public static void StoreSecret(string name, string? value)
    {
        var attributes = new LsaObjectAttributes { Length = Marshal.SizeOf<LsaObjectAttributes>() };
        var status = LsaOpenPolicy(IntPtr.Zero, ref attributes, PolicyCreateSecret, out var policy);
        if (status != 0)
        {
            throw new Win32Exception(LsaNtStatusToWinError(status), "LsaOpenPolicy");
        }

        try
        {
            var key = LsaString.From(name);
            try
            {
                if (value is null)
                {
                    status = LsaStorePrivateData(policy, ref key, IntPtr.Zero);
                    // Removing a secret that is not there is no error for us.
                    if (status != 0 && LsaNtStatusToWinError(status) != 2)
                    {
                        throw new Win32Exception(LsaNtStatusToWinError(status), "LsaStorePrivateData (remove)");
                    }

                    return;
                }

                var data = LsaString.From(value);
                try
                {
                    var pointer = Marshal.AllocHGlobal(Marshal.SizeOf<LsaString>());
                    try
                    {
                        Marshal.StructureToPtr(data, pointer, false);
                        status = LsaStorePrivateData(policy, ref key, pointer);
                    }
                    finally
                    {
                        Marshal.FreeHGlobal(pointer);
                    }

                    if (status != 0)
                    {
                        throw new Win32Exception(LsaNtStatusToWinError(status), "LsaStorePrivateData");
                    }
                }
                finally
                {
                    data.Free();
                }
            }
            finally
            {
                key.Free();
            }
        }
        finally
        {
            LsaClose(policy);
        }
    }

    /// <summary>Is there an LSA secret with this name? (Its value is never read out.)</summary>
    public static bool SecretExists(string name)
    {
        var attributes = new LsaObjectAttributes { Length = Marshal.SizeOf<LsaObjectAttributes>() };
        if (LsaOpenPolicy(IntPtr.Zero, ref attributes, PolicyGetPrivateInformation, out var policy) != 0)
        {
            return false;
        }

        try
        {
            var key = LsaString.From(name);
            try
            {
                var status = LsaRetrievePrivateData(policy, ref key, out var data);
                if (data != IntPtr.Zero)
                {
                    LsaFreeMemory(data);
                }

                return status == 0;
            }
            finally
            {
                key.Free();
            }
        }
        finally
        {
            LsaClose(policy);
        }
    }

    /// <summary>The account's profile folder, made now if the account has never logged on.</summary>
    public static string EnsureProfile(string sid, string user)
    {
        var buffer = new char[260];
        var result = CreateProfile(sid, user, buffer, (uint)buffer.Length);
        // ERROR_ALREADY_EXISTS as an HRESULT: the profile is there, its path is in the registry.
        if (result != 0 && result != unchecked((int)0x800700B7))
        {
            throw new Win32Exception(result, "CreateProfile");
        }

        return result == 0 ? new string(buffer).TrimEnd('\0') : string.Empty;
    }

    public static void DeleteProfileOf(string sid) => DeleteProfile(sid, null, null);

    /// <summary>The privileges loading another user's hive needs; administrators have them, switched off.</summary>
    public static void EnableHivePrivileges()
    {
        foreach (var privilege in new[] { "SeBackupPrivilege", "SeRestorePrivilege" })
        {
            if (!OpenProcessToken(System.Diagnostics.Process.GetCurrentProcess().Handle, TokenAdjustPrivileges | TokenQuery, out var token))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcessToken");
            }

            try
            {
                if (!LookupPrivilegeValue(null, privilege, out var luid))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), privilege);
                }

                var state = new TokenPrivileges { Count = 1, Luid = luid, Attributes = SePrivilegeEnabled };
                if (!AdjustTokenPrivileges(token, false, ref state, 0, IntPtr.Zero, IntPtr.Zero))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), privilege);
                }
            }
            finally
            {
                CloseHandle(token);
            }
        }
    }

    public static void LoadHive(string mountName, string file)
    {
        var code = RegLoadKey(HkeyUsers, mountName, file);
        if (code != 0)
        {
            throw new Win32Exception(code, $"RegLoadKey {file}");
        }
    }

    public static void UnloadHive(string mountName)
    {
        // A handle the GC has not closed yet keeps the hive busy for a moment.
        for (var attempt = 0; attempt < 10; attempt++)
        {
            GC.Collect();
            GC.WaitForPendingFinalizers();
            if (RegUnLoadKey(HkeyUsers, mountName) == 0)
            {
                return;
            }

            Thread.Sleep(200);
        }
    }

    /// <summary>Who is logged on in a session; null at the logon screen.</summary>
    public static string? SessionUser(int session)
    {
        if (!WTSQuerySessionInformation(IntPtr.Zero, session, WtsUserName, out var buffer, out _))
        {
            return null;
        }

        try
        {
            var name = Marshal.PtrToStringUni(buffer);
            return string.IsNullOrEmpty(name) ? null : name;
        }
        finally
        {
            WTSFreeMemory(buffer);
        }
    }

    private static readonly IntPtr HkeyUsers = unchecked((IntPtr)(int)0x80000003);
    private const int WtsUserName = 5;
    private const uint PolicyCreateSecret = 0x00000020;
    private const uint PolicyGetPrivateInformation = 0x00000004;
    private const uint TokenAdjustPrivileges = 0x0020;
    private const uint TokenQuery = 0x0008;
    private const uint SePrivilegeEnabled = 0x00000002;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct UserInfo1
    {
        public string Name;
        public string Password;
        public uint PasswordAge;
        public uint Privilege;
        public string? HomeDir;
        public string? Comment;
        public uint Flags;
        public string? ScriptPath;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct UserInfo1003
    {
        public string Password;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct LocalGroupMembersInfo3
    {
        public string DomainAndName;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LsaObjectAttributes
    {
        public int Length;
        public IntPtr RootDirectory;
        public IntPtr ObjectName;
        public uint Attributes;
        public IntPtr SecurityDescriptor;
        public IntPtr SecurityQualityOfService;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LsaString
    {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;

        public static LsaString From(string value) => new()
        {
            Buffer = Marshal.StringToHGlobalUni(value),
            Length = (ushort)(value.Length * 2),
            MaximumLength = (ushort)((value.Length + 1) * 2),
        };

        public readonly void Free() => Marshal.FreeHGlobal(Buffer);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Luid
    {
        public uint Low;
        public int High;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TokenPrivileges
    {
        public uint Count;
        public Luid Luid;
        public uint Attributes;
    }

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int NetUserAdd(string? server, int level, ref UserInfo1 info, out int error);

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int NetUserSetInfo(string? server, string user, int level, ref UserInfo1003 info, out int error);

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int NetUserGetInfo(string? server, string user, int level, out IntPtr buffer);

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int NetUserDel(string? server, string user);

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int NetLocalGroupAddMembers(string? server, string group, int level, ref LocalGroupMembersInfo3 members, int count);

    [DllImport("netapi32.dll")]
    private static extern int NetApiBufferFree(IntPtr buffer);

    [DllImport("advapi32.dll")]
    private static extern uint LsaOpenPolicy(IntPtr system, ref LsaObjectAttributes attributes, uint access, out IntPtr policy);

    [DllImport("advapi32.dll")]
    private static extern uint LsaStorePrivateData(IntPtr policy, ref LsaString key, IntPtr data);

    [DllImport("advapi32.dll")]
    private static extern uint LsaRetrievePrivateData(IntPtr policy, ref LsaString key, out IntPtr data);

    [DllImport("advapi32.dll")]
    private static extern uint LsaFreeMemory(IntPtr buffer);

    [DllImport("advapi32.dll")]
    private static extern uint LsaClose(IntPtr policy);

    [DllImport("advapi32.dll")]
    private static extern int LsaNtStatusToWinError(uint status);

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    private static extern int CreateProfile(string sid, string user, [Out] char[] path, uint length);

    [DllImport("userenv.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool DeleteProfile(string sid, string? path, string? computer);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool LookupPrivilegeValue(string? system, string name, out Luid luid);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TokenPrivileges state, uint length, IntPtr previous, IntPtr returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int RegLoadKey(IntPtr key, string subKey, string file);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int RegUnLoadKey(IntPtr key, string subKey);

    [DllImport("wtsapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool WTSQuerySessionInformation(IntPtr server, int session, int infoClass, out IntPtr buffer, out int bytes);

    [DllImport("wtsapi32.dll")]
    private static extern void WTSFreeMemory(IntPtr memory);
}
