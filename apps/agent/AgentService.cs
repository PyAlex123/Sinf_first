using System.Diagnostics;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text.Json;
using Microsoft.Win32;
using Sinf.Desktop.Core;
using Sinf.Windows;

namespace Sinf.Agent;

/// <summary>
/// The service (B7, ADR-024): every second the watchdog looks at the computer's console — the student
/// account logged on and no Sinf there means Sinf died, and it is started again in that session; the
/// pipe <c>\\.\pipe\Sinf.Agent</c> keeps the teacher's lock for a restarted Sinf and gives the
/// administrator maintenance time for the exit password.
/// </summary>
internal sealed class AgentService : ServiceBase
{
    private static readonly TimeSpan StartGap = TimeSpan.FromSeconds(3);

    private readonly AgentMemory memory = new();
    private readonly CancellationTokenSource stopping = new();
    private readonly object gate = new();
    private string user = AgentPlan.DefaultUser;
    private System.Threading.Timer? watchdog;
    private DateTimeOffset lastStart = DateTimeOffset.MinValue;

    public AgentService()
    {
        ServiceName = AgentPlan.ServiceName;
        CanStop = true;
    }

    private static string UpdatingMarker => Path.Combine(Setup.AppDir, "updates", "installing");

    protected override void OnStart(string[] args)
    {
        user = Setup.LoadState()?.User ?? AgentPlan.DefaultUser;
        watchdog = new System.Threading.Timer(_ => Tick(), null, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1));
        _ = Task.Run(() => ServeAsync(stopping.Token));
    }

    protected override void OnStop()
    {
        stopping.Cancel();
        watchdog?.Dispose();
    }

    private void Tick()
    {
        if (!Monitor.TryEnter(gate))
        {
            return;
        }

        try
        {
            var now = DateTimeOffset.UtcNow;
            var session = UserSession.ConsoleSession();
            if (session <= 0)
            {
                return;
            }

            var running = Process.GetProcessesByName("Sinf").Any(p => p.SessionId == session);
            DateTimeOffset? updating = File.Exists(UpdatingMarker) ? File.GetLastWriteTimeUtc(UpdatingMarker) : null;
            var step = memory.Decide(now, Native.SessionUser(session), user, running, updating);
            if (step == WatchdogStep.StartShell && now - lastStart > StartGap)
            {
                lastStart = now;
                UserSession.Start(Setup.SinfExe, session);
            }
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException or IOException)
        {
            // The next second tries again.
        }
        finally
        {
            Monitor.Exit(gate);
        }
    }

    /// <summary>One line in, one line out, per connection. Anyone on this computer may knock; only the
    /// exit password buys maintenance time, and a lock message only adds a memory.</summary>
    private async Task ServeAsync(CancellationToken token)
    {
        var security = new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null), PipeAccessRights.ReadWrite, AccessControlType.Allow));

        while (!token.IsCancellationRequested)
        {
            try
            {
                await using var pipe = NamedPipeServerStreamAcl.Create(
                    AgentPlan.PipeName, PipeDirection.InOut, 4, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096, security);
                await pipe.WaitForConnectionAsync(token).ConfigureAwait(false);
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
                timeout.CancelAfter(TimeSpan.FromSeconds(5));
                using var reader = new StreamReader(pipe, leaveOpen: true);
                await using var writer = new StreamWriter(pipe, leaveOpen: true) { AutoFlush = true };
                var line = await reader.ReadLineAsync(timeout.Token).ConfigureAwait(false);
                var request = line is null ? null : AgentRequest.Parse(line);
                var wasMaintenance = memory.InMaintenance(DateTimeOffset.UtcNow);
                string answer;
                lock (gate)
                {
                    answer = AgentConversation.Handle(memory, request, ExitHashes(), DateTimeOffset.UtcNow);
                }

                await writer.WriteLineAsync(answer.AsMemory(), timeout.Token).ConfigureAwait(false);
                if (!wasMaintenance && memory.InMaintenance(DateTimeOffset.UtcNow))
                {
                    // The administrator gets an ordinary desktop for the maintenance time.
                    var session = UserSession.ConsoleSession();
                    if (session > 0)
                    {
                        UserSession.Start(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"), session);
                    }
                }
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                return;
            }
            catch (Exception error) when (error is IOException or OperationCanceledException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
            {
                // A client that went away mid-line; the next one is served.
            }
        }
    }

    /// <summary>The exit password hashes the student computer's Sinf keeps (H3), from every profile.</summary>
    private static IReadOnlyList<string> ExitHashes()
    {
        var hashes = new List<string>();
        using var profiles = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList");
        foreach (var sid in profiles?.GetSubKeyNames() ?? [])
        {
            using var profile = profiles?.OpenSubKey(sid);
            if (profile?.GetValue("ProfileImagePath") is not string raw)
            {
                continue;
            }

            var file = Path.Combine(Environment.ExpandEnvironmentVariables(raw), "AppData", "Local", "Sinf", "config.json");
            try
            {
                if (!File.Exists(file))
                {
                    continue;
                }

                using var doc = JsonDocument.Parse(File.ReadAllText(file));
                if (doc.RootElement.TryGetProperty("ExitPasswordHash", out var hash) && hash.GetString() is { } value && ExitPassword.IsWellFormed(value))
                {
                    hashes.Add(value);
                }
            }
            catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException or InvalidOperationException)
            {
                // Unreadable settings give no password.
            }
        }

        return hashes;
    }
}
