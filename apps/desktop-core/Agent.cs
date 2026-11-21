using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Sinf.Desktop.Core;

/// <summary>Where a registry value lives: the whole computer, or the student account's own hive.</summary>
public enum RegistryHive
{
    LocalMachine,
    StudentUser,
}

/// <summary>One registry value the agent sets; null data means "remove the value".</summary>
public sealed record RegistryValue(RegistryHive Hive, string Key, string Name, object? Data)
{
    public string Id => $"{Hive}\\{Key}\\{Name}";
}

/// <summary>A value as it was before the agent touched it: null data — there was none.</summary>
public sealed record SavedValue(string Id, object? Data);

/// <summary>
/// The closed environment of a student computer (PLAN.md 6.4; stage 6, B7; ADR-024; CLAUDE.md §8):
/// what the agent changes in Windows, and how it is undone. Pure: the agent (apps/agent) applies
/// these lists and remembers what was there before, so <c>disable</c> brings back ordinary Windows.
/// </summary>
public static class AgentPlan
{
    public const string DefaultUser = "Ученик";
    public const string ServiceName = "SinfAgent";
    public const string PipeName = "Sinf.Agent";

    private const string Winlogon = @"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon";
    private const string UserWinlogon = @"Software\Microsoft\Windows NT\CurrentVersion\Winlogon";
    private const string UserSystem = @"Software\Microsoft\Windows\CurrentVersion\Policies\System";
    private const string UserExplorer = @"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer";
    private const string UserWindowsSystem = @"Software\Policies\Microsoft\Windows\System";

    /// <summary>Drives A: to Z: — hidden in Open and Save dialogs (still reachable by typing a path).</summary>
    public const int AllDrives = 0x03FFFFFF;

    /// <summary>
    /// The computer logs into the student account by itself. The password is not here: it goes into
    /// the LSA secret "DefaultPassword", never into the registry as text (ADR-024).
    /// </summary>
    public static IReadOnlyList<RegistryValue> Machine(string user, string computer) =>
    [
        new(RegistryHive.LocalMachine, Winlogon, "AutoAdminLogon", "1"),
        new(RegistryHive.LocalMachine, Winlogon, "DefaultUserName", user),
        new(RegistryHive.LocalMachine, Winlogon, "DefaultDomainName", computer),
        // A password left in plain text by an earlier tool would win over the LSA secret: it goes.
        new(RegistryHive.LocalMachine, Winlogon, "DefaultPassword", null),
        // Winlogon brings the shell back too; the watchdog is the second line.
        new(RegistryHive.LocalMachine, Winlogon, "AutoRestartShell", 1),
    ];

    /// <summary>
    /// The student account only: Sinf instead of Explorer, and the policies of CLAUDE.md §8 — no Task
    /// Manager, no locking, no password change, no logging off from the Ctrl+Alt+Del screen, no
    /// command line or registry editor, the drives hidden in dialogs.
    /// </summary>
    public static IReadOnlyList<RegistryValue> StudentUser(string shell) =>
    [
        new(RegistryHive.StudentUser, UserWinlogon, "Shell", shell),
        new(RegistryHive.StudentUser, UserSystem, "DisableTaskMgr", 1),
        new(RegistryHive.StudentUser, UserSystem, "DisableLockWorkstation", 1),
        new(RegistryHive.StudentUser, UserSystem, "DisableChangePassword", 1),
        new(RegistryHive.StudentUser, UserSystem, "DisableRegistryTools", 1),
        new(RegistryHive.StudentUser, UserExplorer, "NoLogoff", 1),
        new(RegistryHive.StudentUser, UserExplorer, "NoClose", 1),
        new(RegistryHive.StudentUser, UserExplorer, "NoDrives", AllDrives),
        new(RegistryHive.StudentUser, UserExplorer, "NoRun", 1),
        new(RegistryHive.StudentUser, UserWindowsSystem, "DisableCMD", 1),
    ];

    /// <summary>
    /// What to write back on <c>disable</c>: every value the agent set gets its old data again, or is
    /// removed when there was none. Values never saved (a hive that could not be read) are left.
    /// </summary>
    public static IReadOnlyList<RegistryValue> Rollback(IEnumerable<RegistryValue> applied, IReadOnlyDictionary<string, SavedValue> saved) =>
        applied.Where(v => saved.ContainsKey(v.Id)).Select(v => v with { Data = saved[v.Id].Data }).ToList();

    /// <summary>
    /// A password nobody types: 24 characters with upper and lower case, digits and signs, so Windows
    /// accepts it under any password policy. It lives only in the LSA secret.
    /// </summary>
    public static string NewPassword()
    {
        const string upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
        const string lower = "abcdefghijkmnopqrstuvwxyz";
        const string digits = "23456789";
        const string signs = "!#%+-=?@_";
        var all = upper + lower + digits + signs;
        var chars = new List<char>
        {
            upper[RandomNumberGenerator.GetInt32(upper.Length)],
            lower[RandomNumberGenerator.GetInt32(lower.Length)],
            digits[RandomNumberGenerator.GetInt32(digits.Length)],
            signs[RandomNumberGenerator.GetInt32(signs.Length)],
        };
        while (chars.Count < 24)
        {
            chars.Add(all[RandomNumberGenerator.GetInt32(all.Length)]);
        }

        return new string(chars.OrderBy(_ => RandomNumberGenerator.GetInt32(int.MaxValue)).ToArray());
    }
}

/// <summary>What the agent remembers between <c>enable</c> and <c>disable</c> (ProgramData, admins only).</summary>
public sealed record AgentState(
    string User,
    bool AccountCreated,
    string? UserSid,
    IReadOnlyDictionary<string, SavedValue> Saved)
{
    public string ToJson()
    {
        using var buffer = new MemoryStream();
        using (var w = new Utf8JsonWriter(buffer, new JsonWriterOptions { Indented = true }))
        {
            w.WriteStartObject();
            w.WriteString("user", User);
            w.WriteBoolean("accountCreated", AccountCreated);
            w.WriteString("userSid", UserSid);
            w.WriteStartArray("saved");
            foreach (var value in Saved.Values)
            {
                w.WriteStartObject();
                w.WriteString("id", value.Id);
                switch (value.Data)
                {
                    case null:
                        w.WriteNull("data");
                        break;
                    case int number:
                        w.WriteNumber("data", number);
                        break;
                    default:
                        w.WriteString("data", value.Data.ToString());
                        break;
                }

                w.WriteEndObject();
            }

            w.WriteEndArray();
            w.WriteEndObject();
        }

        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    public static AgentState? Parse(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var r = doc.RootElement;
            var saved = new Dictionary<string, SavedValue>();
            foreach (var item in r.GetProperty("saved").EnumerateArray())
            {
                var id = item.GetProperty("id").GetString() ?? string.Empty;
                var data = item.GetProperty("data");
                object? value = data.ValueKind switch
                {
                    JsonValueKind.Number => data.GetInt32(),
                    JsonValueKind.String => data.GetString(),
                    _ => null,
                };
                saved[id] = new SavedValue(id, value);
            }

            return new AgentState(
                r.GetProperty("user").GetString() ?? AgentPlan.DefaultUser,
                r.GetProperty("accountCreated").GetBoolean(),
                r.TryGetProperty("userSid", out var sid) && sid.ValueKind == JsonValueKind.String ? sid.GetString() : null,
                saved);
        }
        catch (Exception error) when (error is JsonException or KeyNotFoundException or InvalidOperationException or FormatException)
        {
            return null;
        }
    }
}

/// <summary>What the watchdog does on a tick.</summary>
public enum WatchdogStep
{
    /// <summary>Nothing to do: Sinf runs, or nobody of ours is at the computer.</summary>
    Wait,

    /// <summary>The administrator asked for time (the exit password), or an update is being installed.</summary>
    Paused,

    StartShell,
}

/// <summary>
/// The agent's memory of the classroom (B7): the teacher's lock outlives a crashed Sinf, and the
/// administrator's maintenance time pauses the watchdog. Kept by the service, asked by Sinf over the
/// pipe when it starts.
/// </summary>
public sealed class AgentMemory
{
    public static readonly TimeSpan Maintenance = TimeSpan.FromMinutes(30);

    /// <summary>A lock older than a lesson is a leftover, not the teacher's will.</summary>
    public static readonly TimeSpan LockLifetime = TimeSpan.FromHours(2);

    /// <summary>An installer that has not finished in this time has failed; the watchdog goes on.</summary>
    public static readonly TimeSpan UpdateLimit = TimeSpan.FromMinutes(20);

    private DateTimeOffset? lockedAt;

    public DateTimeOffset? MaintenanceUntil { get; private set; }

    public bool Locked(DateTimeOffset now) => lockedAt is { } at && now - at < LockLifetime;

    public void SetLock(bool on, DateTimeOffset now) => lockedAt = on ? now : null;

    public void BeginMaintenance(DateTimeOffset now) => MaintenanceUntil = now + Maintenance;

    public void EndMaintenance() => MaintenanceUntil = null;

    public bool InMaintenance(DateTimeOffset now) => MaintenanceUntil is { } until && now < until;

    /// <summary>
    /// Restart Sinf? Only for the student account at the console, only when no Sinf runs there, and
    /// not during maintenance or an update.
    /// </summary>
    public WatchdogStep Decide(DateTimeOffset now, string? sessionUser, string studentUser, bool shellRunning, DateTimeOffset? updatingSince)
    {
        if (!string.Equals(sessionUser, studentUser, StringComparison.OrdinalIgnoreCase) || shellRunning)
        {
            return WatchdogStep.Wait;
        }

        if (InMaintenance(now) || (updatingSince is { } since && now - since < UpdateLimit))
        {
            return WatchdogStep.Paused;
        }

        return WatchdogStep.StartShell;
    }
}

/// <summary>A message from Sinf to the agent over the pipe, one JSON object per line.</summary>
public abstract record AgentRequest
{
    /// <summary>Sinf has started: what should it know? (the lock, maintenance)</summary>
    public sealed record Hello : AgentRequest;

    /// <summary>The teacher locked or unlocked this computer.</summary>
    public sealed record Lock(bool On) : AgentRequest;

    /// <summary>The administrator typed the exit password; the agent checks it itself.</summary>
    public sealed record Maintenance(string? Password) : AgentRequest;

    public static AgentRequest? Parse(string line)
    {
        try
        {
            using var doc = JsonDocument.Parse(line);
            var r = doc.RootElement;
            return (r.TryGetProperty("type", out var t) ? t.GetString() : null) switch
            {
                "hello" => new Hello(),
                "lock" => new Lock(r.TryGetProperty("on", out var on) && on.ValueKind == JsonValueKind.True),
                "maintenance" => new Maintenance(r.TryGetProperty("password", out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null),
                _ => null,
            };
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static string Answer(bool locked, bool maintenance, bool ok = true)
    {
        using var buffer = new MemoryStream();
        using (var w = new Utf8JsonWriter(buffer))
        {
            w.WriteStartObject();
            w.WriteBoolean("ok", ok);
            w.WriteBoolean("lock", locked);
            w.WriteBoolean("maintenance", maintenance);
            w.WriteEndObject();
        }

        return Encoding.UTF8.GetString(buffer.ToArray());
    }
}

/// <summary>The agent's side of the conversation: one request in, one answer out.</summary>
public static class AgentConversation
{
    /// <summary>
    /// <paramref name="exitHashes"/> — the exit password hashes this computer's Sinf keeps; none
    /// means setup time, when the kiosk guards nothing yet (as Sinf itself, H3).
    /// </summary>
    public static string Handle(AgentMemory memory, AgentRequest? request, IReadOnlyList<string> exitHashes, DateTimeOffset now)
    {
        switch (request)
        {
            case AgentRequest.Lock l:
                memory.SetLock(l.On, now);
                break;
            case AgentRequest.Maintenance m:
                var allowed = exitHashes.Count == 0 || exitHashes.Any(h => ExitPassword.Verify(m.Password, h));
                if (!allowed)
                {
                    return AgentRequest.Answer(memory.Locked(now), memory.InMaintenance(now), ok: false);
                }

                memory.BeginMaintenance(now);
                break;
            case AgentRequest.Hello:
                break;
            default:
                return AgentRequest.Answer(memory.Locked(now), memory.InMaintenance(now), ok: false);
        }

        return AgentRequest.Answer(memory.Locked(now), memory.InMaintenance(now));
    }
}
