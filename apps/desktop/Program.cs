namespace Sinf.Desktop;

internal static class Program
{
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

        var paths = AppPaths.Create();
        var config = HostConfig.Load(paths);
        var setup = HasFlag(args, "--setup");
        var dev = HasFlag(args, "--dev");

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

            config = config with { Role = dialog.Role, PcName = dialog.PcName };
            HostConfig.Save(paths, config);
        }

        Application.Run(config.IsStudent ? new StudentForm(paths, config, dev) : new MainForm(paths, config));
    }

    private static bool HasFlag(string[] args, string flag) =>
        args.Any(a => string.Equals(a, flag, StringComparison.OrdinalIgnoreCase));
}
