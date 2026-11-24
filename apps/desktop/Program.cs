using Sinf.Desktop.Core;

namespace Sinf.Desktop;

internal static class Program
{
    /// <summary>
    /// One Sinf per Windows session (H17): the installer starts it for every user with Windows, and
    /// a second copy — a double click, or the user's own autostart from before the installer —
    /// would fight the first for the screen, the keyboard hooks and the lesson server's port.
    /// </summary>
    private const string MutexName = "Sinf.Desktop.Running";

    /// <summary>
    /// One Sinf.exe for the whole classroom (ADR-014 §1): the first start asks what this computer is.
    /// `Sinf.exe --setup` asks again; `Sinf.exe --dev` opens a student's window without the kiosk.
    /// On a student's computer both need the administrator's password (CLAUDE.md §9.9), or a child
    /// would turn the kiosk into a teacher's computer.
    /// </summary>
    [STAThread]
    private static void Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        // The installer test (pc-test.md 8.3): the server of the installed program, started as the
        // window starts it, with no window and no kiosk.
        if (HasFlag(args, SelfTest.Flag))
        {
            Environment.ExitCode = SelfTest.Run();
            return;
        }

        using var running = new Mutex(initiallyOwned: true, MutexName, out var first);
        if (!first && !WaitForPrevious(running, HasFlag(args, "--restart")))
        {
            return;
        }

        var paths = AppPaths.Create();
        var config = HostConfig.Load(paths);
        var setup = HasFlag(args, "--setup");
        var dev = HasFlag(args, "--dev");

        // What the installer was told about this computer (H17): no role window on each computer.
        // Taken at the first start and after a reinstall that says something new (finding 2).
        var fromInstaller = ReadSetupFile(paths);
        if (!setup
            && SetupFile.Decide(fromInstaller, config.Role, config.PcName, config.SetupApplied) is { } decision)
        {
            config = config with { Role = decision.Role, PcName = decision.PcName, SetupApplied = decision.AppliedKey };
            if (decision.NewRole)
            {
                // As after `--setup`: a computer that changed its kind meets its teacher anew (H9).
                config = config with { TeacherKey = null, TeacherUrl = null };
            }

            HostConfig.Save(paths, config);
        }

        if (config.IsStudent && config.HasExitPassword && (setup || dev))
        {
            using var check = new ExitPasswordDialog(
                config.ExitPasswordHash!,
                offerSetup: false,
                setup ? "Смена настроек этого компьютера." : "Режим разработки: окно без киоска.");
            if (check.ShowDialog() != DialogResult.OK)
            {
                return;
            }
        }

        if (setup || !config.HasRole)
        {
            using var dialog = new RoleDialog(config);
            if (dialog.ShowDialog() != DialogResult.OK)
            {
                return;
            }

            // A student computer set up again meets its teacher anew (H9): the first signed answer is
            // remembered. The exit password stays until the new teacher hands over its own.
            config = config with { Role = dialog.Role, PcName = dialog.PcName, TeacherKey = null, TeacherUrl = null };
            // The installer's file is taken as seen, so it does not undo this choice at the next start.
            if (fromInstaller is not null)
            {
                config = config with { SetupApplied = SetupFile.Key(fromInstaller) };
            }

            HostConfig.Save(paths, config);
        }

        // A student's computer opens Sinf with Windows (H7); a teacher's starts it when the lesson needs it.
        // The developer's window does not register itself.
        if (!dev)
        {
            AutostartSetting.Apply(config.IsStudent);
        }

        Application.Run(config.IsStudent ? new StudentForm(paths, config, dev) : new MainForm(paths, config));
    }

    /// <summary>
    /// Another Sinf is running in this session. Only a restart Sinf asked for itself (a new role,
    /// <c>--restart</c>) waits for it to close; anything else leaves the running one alone.
    /// </summary>
    private static bool WaitForPrevious(Mutex running, bool restart)
    {
        if (!restart)
        {
            return false;
        }

        try
        {
            return running.WaitOne(TimeSpan.FromSeconds(15));
        }
        catch (AbandonedMutexException)
        {
            // The previous one ended without letting go: the mutex is ours now.
            return true;
        }
    }

    private static SetupChoice? ReadSetupFile(AppPaths paths)
    {
        var file = Path.Combine(paths.Root, SetupFile.FileName);
        try
        {
            return File.Exists(file) && new FileInfo(file).Length <= SetupFile.MaxBytes
                ? SetupFile.Parse(File.ReadAllText(file))
                : null;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static bool HasFlag(string[] args, string flag) =>
        args.Any(a => string.Equals(a, flag, StringComparison.OrdinalIgnoreCase));
}
