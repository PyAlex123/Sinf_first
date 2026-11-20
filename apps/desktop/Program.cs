namespace Sinf.Desktop;

internal static class Program
{
    /// <summary>
    /// One Sinf.exe for the whole classroom (ADR-014 §1): the first start asks what this computer is,
    /// `Sinf.exe --setup` asks again.
    /// </summary>
    [STAThread]
    private static void Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var paths = AppPaths.Create();
        var config = HostConfig.Load(paths);
        var setup = args.Any(a => string.Equals(a, "--setup", StringComparison.OrdinalIgnoreCase));
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

        Application.Run(config.IsStudent ? new StudentForm(paths, config) : new MainForm(paths, config));
    }
}
