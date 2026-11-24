namespace Sinf.Desktop;

/// <summary>
/// <c>Sinf.exe --selftest</c>: starts the lesson server exactly as the teacher's window does — the same
/// folders, variables and settings file — waits until <c>/health</c> answers and stops it again. The
/// installer test runs it after a real installation: once the server died in Program Files on a
/// package the build folder still had (pc-test.md 8.3), and only a run of the installed program shows
/// that. No window, nothing of the kiosk is touched. Exit code 0 — the server answered, 1 — it did
/// not; the reason is in <c>logs\selftest.log</c> next to <c>server.log</c>.
/// </summary>
internal static class SelfTest
{
    public const string Flag = "--selftest";

    public static int Run()
    {
        var paths = AppPaths.Create();
        var result = Path.Combine(Path.GetDirectoryName(paths.LogFile)!, "selftest.log");
        try
        {
            var config = HostConfig.Load(paths);
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(90));
            var server = ServerProcess
                .StartAsync(paths, config, _ => { }, timeout.Token)
                .GetAwaiter()
                .GetResult();
            var port = server.Port;
            server.DisposeAsync().AsTask().GetAwaiter().GetResult();
            File.WriteAllText(result, $"ok: the server answered /health on port {port}{Environment.NewLine}");
            return 0;
        }
        catch (Exception error)
        {
            var details = error is ServerStartException failed && failed.LogTail.Length > 0
                ? $"{Environment.NewLine}{failed.LogTail}"
                : string.Empty;
            File.WriteAllText(result, $"failed: {error.Message}{details}{Environment.NewLine}");
            return 1;
        }
    }
}
