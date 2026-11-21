using System.Diagnostics;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32;
using Sinf.Desktop.Core;

namespace Sinf.Agent;

/// <summary>
/// <c>enable</c>, <c>disable</c> and <c>status</c> (B7, ADR-024). Every value is written through
/// <see cref="AgentPlan"/>, and what was there before is saved first, once: <c>disable</c> writes it
/// back, so the computer is ordinary Windows again.
/// </summary>
internal static class Setup
{
    private const string HiveMount = "SinfStudent";

    public static string AppDir => AppContext.BaseDirectory.TrimEnd('\\', '/');

    public static string SinfExe => Path.Combine(AppDir, "Sinf.exe");

    private static string StateDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Sinf", "agent");

    private static string StateFile => Path.Combine(StateDir, "state.json");

    public static AgentState? LoadState()
    {
        try
        {
            return File.Exists(StateFile) ? AgentState.Parse(File.ReadAllText(StateFile)) : null;
        }
        catch (IOException)
        {
            return null;
        }
    }

    public static int Enable(string user)
    {
        var before = LoadState();
        if (before is not null && !string.Equals(before.User, user, StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine($"Агент уже включён для «{before.User}». Сначала: Sinf.Agent.exe disable");
            return 3;
        }

        var password = AgentPlan.NewPassword();
        var created = Native.CreateOrResetUser(user, password, "Sinf: ученик (закрытая среда)");
        Native.AddToGroup(UsersGroup(), user);
        var sid = new NTAccount(user).Translate(typeof(SecurityIdentifier)).Value;
        Console.WriteLine(created ? $"учётка «{user}» создана" : $"учётка «{user}» уже была: новый пароль");

        var saved = new Dictionary<string, SavedValue>(before?.Saved ?? new Dictionary<string, SavedValue>());
        // Saved before anything is written: a failure in the middle can still be undone.
        var state = new AgentState(user, (before?.AccountCreated ?? false) || created, sid, saved);
        SaveState(state);

        foreach (var value in AgentPlan.Machine(user, Environment.MachineName))
        {
            Apply(Registry.LocalMachine, value, saved);
        }

        SaveState(state);
        Native.StoreSecret("DefaultPassword", password);
        Console.WriteLine("автовход включён (пароль — в секрете LSA)");

        WithStudentHive(sid, user, root =>
        {
            foreach (var value in AgentPlan.StudentUser(SinfExe))
            {
                Apply(root, value, saved);
            }
        });
        SaveState(state);
        Console.WriteLine($"оболочка «{user}» — Sinf.exe; политики §8 включены");

        InstallService();
        Console.WriteLine("служба SinfAgent запущена. Перезагрузите компьютер: войдёт «" + user + "».");
        return 0;
    }

    public static int Disable(bool removeAccount)
    {
        RemoveService();
        var state = LoadState();
        if (state is null)
        {
            Console.WriteLine("агент не был включён: менять нечего");
            return 0;
        }

        foreach (var value in AgentPlan.Rollback(AgentPlan.Machine(state.User, Environment.MachineName), state.Saved))
        {
            Write(Registry.LocalMachine, value);
        }

        Native.StoreSecret("DefaultPassword", null);
        Console.WriteLine("автовход возвращён как был");

        if (state.UserSid is { } sid && Native.UserExists(state.User))
        {
            WithStudentHive(sid, state.User, root =>
            {
                foreach (var value in AgentPlan.Rollback(AgentPlan.StudentUser(SinfExe), state.Saved))
                {
                    Write(root, value);
                }
            });
            Console.WriteLine($"оболочка и политики «{state.User}» возвращены");

            if (removeAccount && state.AccountCreated)
            {
                Native.DeleteUser(state.User);
                Native.DeleteProfileOf(sid);
                Console.WriteLine($"учётка «{state.User}» удалена");
            }
        }

        File.Delete(StateFile);
        Console.WriteLine("обычная Windows возвращена");
        return 0;
    }

    public static int Status()
    {
        var state = LoadState();
        var user = state?.User ?? AgentPlan.DefaultUser;
        Line("enabled", state is not null);
        Line("service", ServiceState());
        Line("account", Native.UserExists(user) ? user : "none");
        using (var winlogon = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"))
        {
            Line("autologon", $"{winlogon?.GetValue("AutoAdminLogon") ?? "-"} {winlogon?.GetValue("DefaultUserName") ?? "-"}");
            Line("plainPassword", winlogon?.GetValue("DefaultPassword") is null ? "none" : "PRESENT");
        }

        Line("secret", Native.SecretExists("DefaultPassword"));
        if (state?.UserSid is { } sid && Native.UserExists(user))
        {
            WithStudentHive(sid, user, root =>
            {
                using var winlogon = root.OpenSubKey(@"Software\Microsoft\Windows NT\CurrentVersion\Winlogon");
                Line("shell", winlogon?.GetValue("Shell") ?? "explorer (default)");
                using var system = root.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Policies\System");
                Line("taskManager", system?.GetValue("DisableTaskMgr") is 1 ? "off" : "on");
            });
        }

        return state is null ? 2 : 0;
    }

    private static void Line(string name, object value) => Console.WriteLine($"{name}: {value}");

    /// <summary>"Users" in the language of this Windows ("Пользователи" on a Russian one).</summary>
    private static string UsersGroup() =>
        new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null).Translate(typeof(NTAccount)).Value.Split('\\').Last();

    /// <summary>Saves what was there (the first time only), then writes the agent's value.</summary>
    private static void Apply(RegistryKey root, RegistryValue value, Dictionary<string, SavedValue> saved)
    {
        if (!saved.ContainsKey(value.Id))
        {
            using var key = root.OpenSubKey(value.Key);
            saved[value.Id] = new SavedValue(value.Id, key?.GetValue(value.Name, null, RegistryValueOptions.DoNotExpandEnvironmentNames) switch
            {
                int number => number,
                string text => text,
                _ => null,
            });
        }

        Write(root, value);
    }

    private static void Write(RegistryKey root, RegistryValue value)
    {
        if (value.Data is null)
        {
            using var existing = root.OpenSubKey(value.Key, writable: true);
            existing?.DeleteValue(value.Name, throwOnMissingValue: false);
            return;
        }

        using var key = root.CreateSubKey(value.Key, writable: true);
        if (value.Data is int number)
        {
            key.SetValue(value.Name, number, RegistryValueKind.DWord);
        }
        else
        {
            key.SetValue(value.Name, value.Data.ToString() ?? string.Empty, RegistryValueKind.String);
        }
    }

    /// <summary>
    /// The student account's own registry: open as it is when they are logged on, else their
    /// NTUSER.DAT loaded for a moment — made first, if the account has never logged on.
    /// </summary>
    private static void WithStudentHive(string sid, string user, Action<RegistryKey> action)
    {
        using (var loaded = Registry.Users.OpenSubKey(sid, writable: true))
        {
            if (loaded is not null)
            {
                action(loaded);
                return;
            }
        }

        var profile = ProfilePath(sid);
        if (profile is null)
        {
            Native.EnsureProfile(sid, user);
            profile = ProfilePath(sid) ?? throw new InvalidOperationException($"профиль «{user}» не создан");
        }

        Native.EnableHivePrivileges();
        Native.LoadHive(HiveMount, Path.Combine(profile, "NTUSER.DAT"));
        try
        {
            using var root = Registry.Users.OpenSubKey(HiveMount, writable: true)
                ?? throw new InvalidOperationException("реестр ученика не открылся");
            action(root);
        }
        finally
        {
            Native.UnloadHive(HiveMount);
        }
    }

    private static string? ProfilePath(string sid)
    {
        using var key = Registry.LocalMachine.OpenSubKey($@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\{sid}");
        return key?.GetValue("ProfileImagePath") is string path ? Environment.ExpandEnvironmentVariables(path) : null;
    }

    /// <summary>Only SYSTEM and administrators may read what the agent remembers.</summary>
    private static void SaveState(AgentState state)
    {
        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        foreach (var sid in new[] { WellKnownSidType.LocalSystemSid, WellKnownSidType.BuiltinAdministratorsSid })
        {
            security.AddAccessRule(new FileSystemAccessRule(
                new SecurityIdentifier(sid, null),
                FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                PropagationFlags.None,
                AccessControlType.Allow));
        }

        var dir = new DirectoryInfo(StateDir);
        if (!dir.Exists)
        {
            dir.Create(security);
        }
        else
        {
            dir.SetAccessControl(security);
        }

        File.WriteAllText(StateFile, state.ToJson());
    }

    private static string ServiceState()
    {
        try
        {
            using var service = new System.ServiceProcess.ServiceController(AgentPlan.ServiceName);
            return service.Status.ToString();
        }
        catch (InvalidOperationException)
        {
            return "none";
        }
    }

    private static void InstallService()
    {
        var exe = Path.Combine(AppDir, "Sinf.Agent.exe");
        var exists = ServiceState() != "none";
        Sc(exists ? "config" : "create", AgentPlan.ServiceName, "binPath=", $"\"{exe}\" run", "start=", "auto", "DisplayName=", "Sinf Agent");
        Sc("description", AgentPlan.ServiceName, "Sinf: закрытая среда ученика — оболочка, блокировка, сторож");
        // Killed or crashed: back in a second, every time.
        Sc("failure", AgentPlan.ServiceName, "reset=", "86400", "actions=", "restart/1000/restart/1000/restart/1000");
        Sc("start", AgentPlan.ServiceName);
    }

    private static void RemoveService()
    {
        if (ServiceState() == "none")
        {
            return;
        }

        Sc("stop", AgentPlan.ServiceName);
        try
        {
            using var service = new System.ServiceProcess.ServiceController(AgentPlan.ServiceName);
            service.WaitForStatus(System.ServiceProcess.ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(20));
        }
        catch (Exception error) when (error is InvalidOperationException or System.ServiceProcess.TimeoutException)
        {
            // Gone already, or slow: delete marks it for removal either way.
        }

        Sc("delete", AgentPlan.ServiceName);
        Console.WriteLine("служба SinfAgent удалена");
    }

    private static void Sc(params string[] args)
    {
        var start = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "sc.exe"))
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            CreateNoWindow = true,
        };
        foreach (var arg in args)
        {
            start.ArgumentList.Add(arg);
        }

        using var process = Process.Start(start);
        process?.StandardOutput.ReadToEnd();
        process?.WaitForExit();
    }
}
