using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using Sinf.Desktop.Core;
using Sinf.Windows;

namespace Sinf.Updater;

/// <summary>
/// Sinf.Updater.exe (PLAN.md 6.11; stage 6, B6; ADR-023). Run by the task "Sinf\Update" as SYSTEM
/// every 30 minutes and after Windows starts:
///
///   Sinf.Updater.exe            — look for an update and install it if the time is right;
///   Sinf.Updater.exe --status   — only say what it would do (for the author, in a console);
///   (internal) --install &lt;file&gt; --sha256 &lt;hash&gt; --app &lt;dir&gt; — the copy that runs the installer.
///
/// It asks the lesson server Sinf named (the classroom's copy), else the platform; downloads into
/// {app}\updates, which only administrators can write; checks size, hash and the signature against
/// the key built into it; waits for lessons to end; installs silently and starts Sinf again on the
/// desktops where it was running.
/// </summary>
internal static class Program
{
    private const string MutexName = @"Global\Sinf.Updater";
    private static readonly TimeSpan InstallerTimeout = TimeSpan.FromMinutes(15);

    private static async Task<int> Main(string[] args)
    {
        var app = Arg(args, "--app") ?? AppContext.BaseDirectory.TrimEnd('\\', '/');
        var dir = Path.Combine(app, "updates");
        Directory.CreateDirectory(dir);
        var status = args.Contains("--status");
        var log = new Log(Path.Combine(dir, "updater.log"), echo: status || args.Contains("--now"));

        using var mutex = new Mutex(false, MutexName);
        var install = Arg(args, "--install");
        // The copy that installs waits for the run that started it to let go.
        if (!mutex.WaitOne(install is null ? TimeSpan.Zero : TimeSpan.FromMinutes(1)))
        {
            log.Write("another updater is running");
            return 0;
        }

        try
        {
            return install is not null
                ? Install(app, dir, install, Arg(args, "--sha256"), log)
                : await CheckAsync(app, dir, status, log).ConfigureAwait(false);
        }
        catch (Exception error)
        {
            log.Write($"error: {error.GetType().Name}: {error.Message}");
            return 1;
        }
        finally
        {
            mutex.ReleaseMutex();
        }
    }

    private static string? PublicKey() =>
        typeof(Program).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(a => a.Key == "SinfUpdatePublicKey")?.Value;

    private static async Task<int> CheckAsync(string app, string dir, bool statusOnly, Log log)
    {
        var key = PublicKey();
        var installed = Machine.InstalledVersion(app);
        var activities = Machine.Activities();
        var lessonHere = Updates.LessonHere(activities, DateTimeOffset.UtcNow);
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };

        LatestUpdate? latest = null;
        string? source = null;
        foreach (var candidate in Updates.Sources(activities))
        {
            latest = await AskAsync(http, candidate).ConfigureAwait(false);
            if (latest?.Update is not null)
            {
                source = candidate;
                break;
            }
        }

        var step = Updates.Decide(key, installed, latest, lessonHere);
        var asked = string.Join(", ", Updates.Sources(activities));
        log.Write(
            $"installed {installed}; key {(string.IsNullOrWhiteSpace(key) ? "none" : "built in")}; " +
            $"asked {(asked.Length > 0 ? asked : "nobody")}; " +
            $"latest {latest?.Update?.Version ?? "none"} from {source ?? "-"}; busy {latest?.Busy == true}; lesson here {lessonHere}: {step}");
        if (statusOnly || step != UpdateStep.Install || source is null || latest?.Update is not { } update)
        {
            return 0;
        }

        var file = await DownloadAsync(source, update, dir, log).ConfigureAwait(false);
        if (file is null)
        {
            return 1;
        }

        // A lesson may have begun during the download: one more look before anything closes.
        var again = await AskAsync(http, source).ConfigureAwait(false);
        if (Updates.LessonHere(Machine.Activities(), DateTimeOffset.UtcNow) || again?.Busy == true)
        {
            log.Write("a lesson began during the download: installing next time");
            return 0;
        }

        // The installer replaces this very program: a copy outside its files runs it.
        var runner = Path.Combine(dir, "run", "Sinf.Updater.exe");
        Directory.CreateDirectory(Path.GetDirectoryName(runner)!);
        File.Copy(Environment.ProcessPath!, runner, overwrite: true);
        var start = new ProcessStartInfo(runner) { UseShellExecute = false };
        foreach (var arg in new[] { "--install", file, "--sha256", update.Sha256, "--app", app })
        {
            start.ArgumentList.Add(arg);
        }

        Process.Start(start)?.Dispose();
        log.Write($"installing {update.Version}");
        return 0;
    }

    private static async Task<LatestUpdate?> AskAsync(HttpClient http, string server)
    {
        try
        {
            return Updates.ParseLatest(await http.GetStringAsync($"{server}/api/updates/latest").ConfigureAwait(false));
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or InvalidOperationException)
        {
            return null;
        }
    }

    /// <summary>The installer into {app}\updates, checked byte for byte against the signed manifest.</summary>
    private static async Task<string?> DownloadAsync(string source, UpdateManifest update, string dir, Log log)
    {
        var target = Path.Combine(dir, update.File);
        if (File.Exists(target) && HashOf(target) == update.Sha256)
        {
            return target;
        }

        var part = target + ".part";
        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(30) };
        try
        {
            using (var response = await http.GetAsync(
                $"{source}/api/updates/{Uri.EscapeDataString(update.Version)}/installer",
                HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false))
            {
                response.EnsureSuccessStatusCode();
                await using var body = await response.Content.ReadAsStreamAsync().ConfigureAwait(false);
                await using var file = File.Create(part);
                await body.CopyToAsync(file).ConfigureAwait(false);
            }

            var size = new FileInfo(part).Length;
            var hash = HashOf(part);
            if (size != update.Size || hash != update.Sha256)
            {
                log.Write($"downloaded file is not the signed one (size {size}, sha256 {hash[..12]}…): deleted");
                File.Delete(part);
                return null;
            }

            File.Move(part, target, overwrite: true);
            foreach (var old in Directory.GetFiles(dir, "Sinf-update-*.exe").Where(f => !string.Equals(f, target, StringComparison.OrdinalIgnoreCase)))
            {
                File.Delete(old);
            }

            log.Write($"downloaded {update.File} ({size / 1024 / 1024} MB)");
            return target;
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or IOException)
        {
            log.Write($"download failed: {error.Message}");
            return null;
        }
    }

    /// <summary>
    /// The copy's work: the installer runs silently (it closes Sinf itself), then Sinf comes back on
    /// every desktop it was on. The marker tells the agent (B7) not to restart Sinf meanwhile.
    /// </summary>
    private static int Install(string app, string dir, string installer, string? sha256, Log log)
    {
        if (!installer.StartsWith(dir, StringComparison.OrdinalIgnoreCase) || sha256 is null || HashOf(installer) != sha256)
        {
            log.Write("installer is not the checked one: not run");
            return 1;
        }

        var sessions = Process.GetProcessesByName("Sinf").Select(p => p.SessionId).Where(s => s > 0).Distinct().ToList();
        var marker = Path.Combine(dir, "installing");
        File.WriteAllText(marker, DateTimeOffset.UtcNow.ToString("O"));
        int code;
        try
        {
            var start = new ProcessStartInfo(installer) { UseShellExecute = false };
            foreach (var arg in Updates.InstallerArguments(Path.Combine(dir, "install.log")))
            {
                start.ArgumentList.Add(arg);
            }

            using var process = Process.Start(start) ?? throw new InvalidOperationException("installer did not start");
            if (!process.WaitForExit(InstallerTimeout))
            {
                log.Write("installer did not finish in 15 minutes");
                return 1;
            }

            code = process.ExitCode;
        }
        finally
        {
            File.Delete(marker);
        }

        log.Write($"installer finished with code {code}; Sinf back in sessions: {string.Join(", ", sessions)}");
        foreach (var session in sessions)
        {
            try
            {
                UserSession.Start(Path.Combine(app, "Sinf.exe"), session);
            }
            catch (System.ComponentModel.Win32Exception error)
            {
                log.Write($"could not start Sinf in session {session}: {error.Message}");
            }
        }

        return code;
    }

    private static string HashOf(string file)
    {
        using var stream = File.OpenRead(file);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    private static string? Arg(string[] args, string name)
    {
        var i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }
}
