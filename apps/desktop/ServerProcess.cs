using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;

namespace Sinf.Desktop;

/// <summary>
/// The Node server that ships inside the package, started hidden and shut down with the window. The app
/// never opens an external browser: this server only feeds the WebView2 inside our own window, and the
/// same address lets student devices on the classroom network join the lesson.
/// </summary>
internal sealed class ServerProcess : IAsyncDisposable
{
    private const int PreferredPort = 3000;

    private readonly Process process;
    private readonly JobObject job;
    private readonly StreamWriter log;

    private ServerProcess(Process process, JobObject job, StreamWriter log, int port)
    {
        this.process = process;
        this.job = job;
        this.log = log;
        Port = port;
    }

    public int Port { get; }

    public string LocalUrl => $"http://127.0.0.1:{Port}";

    /// <summary>Starts the server and returns once <c>/health</c> answers.</summary>
    public static async Task<ServerProcess> StartAsync(
        AppPaths paths,
        HostConfig config,
        Action<string> report,
        CancellationToken token)
    {
        var missing = paths.FindMissingPart();
        if (missing is not null)
        {
            throw new FileNotFoundException(
                $"Папка программы неполная: не найдено «{missing}». Распакуйте архив целиком.",
                missing);
        }

        var port = FreePort();
        var start = new ProcessStartInfo(paths.NodeExe)
        {
            // The server reads only the variables below; no .env file is shipped with the package.
            WorkingDirectory = paths.ServerDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        start.ArgumentList.Add(paths.ServerEntry);
        start.Environment["NODE_ENV"] = "production";
        start.Environment["PORT"] = port.ToString();
        // 0.0.0.0, so students on the classroom network can reach the lesson from their own devices.
        start.Environment["HOST"] = "0.0.0.0";
        start.Environment["DATA_DIR"] = paths.Data;
        start.Environment["DATABASE_PATH"] = paths.DatabasePath;
        start.Environment["CONTENT_DIR"] = paths.ContentDir;
        start.Environment["WEB_DIR"] = paths.WebDir;
        start.Environment["SESSION_SECRET"] = config.SessionSecret;
        start.Environment["DEMO_TEACHER_PASSWORD"] = config.TeacherPassword;
        start.Environment["LOG_LEVEL"] = "info";

        var writer = new StreamWriter(
            new FileStream(paths.LogFile, FileMode.Create, FileAccess.Write, FileShare.Read))
        {
            AutoFlush = true,
        };
        var started = Process.Start(start)
            ?? throw new InvalidOperationException("Не удалось запустить server\\node.exe.");
        var job = new JobObject();
        job.Add(started.Handle);
        started.OutputDataReceived += (_, e) => Write(writer, e.Data);
        started.ErrorDataReceived += (_, e) => Write(writer, e.Data);
        started.BeginOutputReadLine();
        started.BeginErrorReadLine();

        var server = new ServerProcess(started, job, writer, port);
        try
        {
            await server.WaitUntilReadyAsync(report, token).ConfigureAwait(false);
        }
        catch
        {
            await server.DisposeAsync().ConfigureAwait(false);
            throw;
        }

        return server;
    }

    private async Task WaitUntilReadyAsync(Action<string> report, CancellationToken token)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var deadline = DateTime.UtcNow.AddSeconds(60);
        var attempt = 0;
        while (DateTime.UtcNow < deadline)
        {
            token.ThrowIfCancellationRequested();
            if (process.HasExited)
            {
                throw new InvalidOperationException(
                    $"Сервер остановился сразу после запуска (код {process.ExitCode}). Журнал: logs\\server.log");
            }

            try
            {
                using var answer = await client.GetAsync($"{LocalUrl}/health", token).ConfigureAwait(false);
                if (answer.IsSuccessStatusCode)
                {
                    return;
                }
            }
            catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
            {
                // Not listening yet.
            }

            attempt++;
            if (attempt == 10)
            {
                report("Первый запуск готовит базу данных, это занимает немного дольше…");
            }

            await Task.Delay(250, token).ConfigureAwait(false);
        }

        throw new TimeoutException("Сервер не ответил за минуту. Журнал: logs\\server.log");
    }

    private static void Write(StreamWriter writer, string? line)
    {
        if (line is null)
        {
            return;
        }

        try
        {
            lock (writer)
            {
                writer.WriteLine(line);
            }
        }
        catch (IOException)
        {
            // The log is a convenience; losing a line must never stop the lesson.
        }
    }

    /// <summary>A free TCP port, preferring 3000 so the address students type stays familiar.</summary>
    private static int FreePort()
    {
        if (CanListen(PreferredPort))
        {
            return PreferredPort;
        }

        using var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        return port;
    }

    private static bool CanListen(int port)
    {
        try
        {
            using var probe = new TcpListener(IPAddress.Any, port);
            probe.Start();
            probe.Stop();
            return true;
        }
        catch (SocketException)
        {
            return false;
        }
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync(new CancellationTokenSource(TimeSpan.FromSeconds(5)).Token)
                    .ConfigureAwait(false);
            }
        }
        catch (Exception error) when (error is InvalidOperationException or OperationCanceledException)
        {
            // Already gone, or too slow to confirm: the job object closes below and takes it down anyway.
        }

        process.Dispose();
        job.Dispose();
        await log.DisposeAsync().ConfigureAwait(false);
    }
}
