using System.Net.Http.Headers;
using System.Text.Json;
using Sinf.Desktop.Core;

namespace Sinf.Desktop;

/// <summary>
/// The lesson's working folder on a student computer (stage 3, H15; ADR-015). When a child logs into a
/// lesson, their "Мои работы" comes from the teacher's computer into
/// <c>%LOCALAPPDATA%\Sinf\work\&lt;random&gt;</c>; programs open and save files there; every save is sent
/// back within a couple of seconds; when the lesson ends the last changes go and the folder is wiped.
/// The work is never kept on this computer between lessons: the next child at this desk finds nothing.
///
/// Until the agent (6.4) closes the disk, a child could open this folder from Paint's dialog: the
/// files in it are only their own, and only for the lesson.
/// </summary>
internal sealed class WorkFolderSync : IAsyncDisposable
{
    private static readonly TimeSpan Settle = TimeSpan.FromMilliseconds(1500);

    private readonly HttpClient http;
    private readonly FileSystemWatcher watcher;
    private readonly System.Threading.Timer debounce;
    private readonly SemaphoreSlim busy = new(1, 1);
    private readonly Dictionary<string, string> known = new(StringComparer.OrdinalIgnoreCase);
    private readonly Action<string> saved;
    private bool stopped;

    public WorkFolderSync(string root, string teacherUrl, string sessionId, string lessonToken, Action<string> saved)
    {
        Folder = Path.Combine(root, Guid.NewGuid().ToString("N")[..12]);
        Directory.CreateDirectory(Folder);
        this.saved = saved;
        http = new HttpClient { BaseAddress = new Uri(teacherUrl), Timeout = TimeSpan.FromSeconds(60) };
        http.DefaultRequestHeaders.Add("x-session-id", sessionId);
        http.DefaultRequestHeaders.Add("x-participant-token", lessonToken);
        debounce = new System.Threading.Timer(_ => _ = SyncAsync(), null, Timeout.Infinite, Timeout.Infinite);
        watcher = new FileSystemWatcher(Folder)
        {
            IncludeSubdirectories = false,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
        };
        FileSystemEventHandler later = (_, _) => debounce.Change(Settle, Timeout.InfiniteTimeSpan);
        watcher.Changed += later;
        watcher.Created += later;
        watcher.Deleted += later;
        watcher.Renamed += (_, _) => debounce.Change(Settle, Timeout.InfiniteTimeSpan);
    }

    /// <summary>The folder of this lesson; programs open and save files here.</summary>
    public string Folder { get; }

    /// <summary>The child's files arrive; changes are watched from now on.</summary>
    public async Task StartAsync()
    {
        await SyncAsync().ConfigureAwait(false);
        watcher.EnableRaisingEvents = true;
    }

    /// <summary>A file of this folder by its name — never a path from outside it.</summary>
    public string? PathOf(string name)
    {
        var path = Path.GetFullPath(Path.Combine(Folder, Path.GetFileName(name)));
        return path.StartsWith(Folder, StringComparison.OrdinalIgnoreCase) ? path : null;
    }

    /// <summary>One exchange: what changed here goes, what is newer there comes (WorkFolder.Plan).</summary>
    public async Task SyncAsync()
    {
        if (!await busy.WaitAsync(0).ConfigureAwait(false))
        {
            // One is running; the change that woke us will be seen by the next.
            debounce.Change(Settle, Timeout.InfiniteTimeSpan);
            return;
        }

        try
        {
            if (stopped)
            {
                return;
            }

            var server = await ListAsync().ConfigureAwait(false);
            if (server is null)
            {
                return;
            }

            var local = Scan();
            foreach (var action in WorkFolder.Plan(server, local, known))
            {
                switch (action)
                {
                    case FolderAction.Download d:
                        await DownloadAsync(d).ConfigureAwait(false);
                        break;
                    case FolderAction.Upload u:
                        await UploadAsync(u).ConfigureAwait(false);
                        break;
                    case FolderAction.Delete del:
                        using (var response = await http.DeleteAsync($"/api/my/files/{Uri.EscapeDataString(del.FileId)}").ConfigureAwait(false))
                        {
                            if (response.IsSuccessStatusCode)
                            {
                                known.Remove(del.Name);
                            }
                        }

                        break;
                }
            }
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or IOException or JsonException)
        {
            // The teacher's computer did not answer, or a file was busy: the next save tries again.
        }
        finally
        {
            busy.Release();
        }
    }

    private async Task<List<ServerFile>?> ListAsync()
    {
        using var response = await http.GetAsync("/api/my/files").ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            return null;
        }

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync().ConfigureAwait(false));
        return document.RootElement.GetProperty("files").EnumerateArray()
            .Select(f => new ServerFile(
                f.GetProperty("id").GetString() ?? string.Empty,
                f.GetProperty("name").GetString() ?? string.Empty,
                f.GetProperty("sha256").GetString() ?? string.Empty,
                f.GetProperty("size").GetInt64()))
            .ToList();
    }

    private List<LocalFile> Scan()
    {
        var files = new List<LocalFile>();
        foreach (var path in Directory.EnumerateFiles(Folder))
        {
            var name = Path.GetFileName(path);
            if (!WorkFolder.IsWork(name))
            {
                continue;
            }

            try
            {
                // Word and Excel keep a file open while it is shown; reading it beside them is allowed.
                using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                files.Add(new LocalFile(name, WorkFolder.Sha256Of(stream), stream.Length));
            }
            catch (IOException)
            {
                // Being written right now: the next exchange takes it.
            }
        }

        return files;
    }

    private async Task DownloadAsync(FolderAction.Download d)
    {
        var path = PathOf(d.Name);
        if (path is null)
        {
            return;
        }

        using var response = await http.GetAsync($"/api/my/files/{Uri.EscapeDataString(d.FileId)}/content").ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            return;
        }

        var bytes = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
        await File.WriteAllBytesAsync(path, bytes).ConfigureAwait(false);
        known[d.Name] = d.Sha256;
    }

    private async Task UploadAsync(FolderAction.Upload u)
    {
        var path = PathOf(u.Name);
        if (path is null)
        {
            return;
        }

        byte[] bytes;
        using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        {
            bytes = new byte[stream.Length];
            await stream.ReadExactlyAsync(bytes).ConfigureAwait(false);
        }

        var query = $"name={Uri.EscapeDataString(u.Name)}" + (u.BaseSha256 is null ? string.Empty : $"&base={u.BaseSha256}");
        using var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        using var response = await http.PutAsync($"/api/my/files?{query}", content).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            return;
        }

        using var stream2 = new MemoryStream(bytes);
        known[u.Name] = WorkFolder.Sha256Of(stream2);
        saved(u.Name);
    }

    /// <summary>The lesson is over: the last changes go, and the folder is wiped.</summary>
    public async ValueTask DisposeAsync()
    {
        watcher.EnableRaisingEvents = false;
        await debounce.DisposeAsync().ConfigureAwait(false);
        await SyncAsync().ConfigureAwait(false);
        stopped = true;
        watcher.Dispose();
        http.Dispose();
        for (var attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                Directory.Delete(Folder, recursive: true);
                break;
            }
            catch (IOException)
            {
                // A program is still closing: try again in a moment.
                await Task.Delay(1000).ConfigureAwait(false);
            }
            catch (UnauthorizedAccessException)
            {
                await Task.Delay(1000).ConfigureAwait(false);
            }
        }
    }
}
