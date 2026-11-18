using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Sinf.Desktop;

/// <summary>
/// Keeping the lesson material on this computer up to date with the platform (S2.5). The platform is
/// where the lessons live; the copy here is what the lesson actually runs from, so a classroom with no
/// internet is not a classroom without a lesson (CLAUDE.md §3.3).
///
/// Media files are named by their content hash (ADR-005), so a name never changes meaning and only
/// what is missing is ever fetched.
/// </summary>
internal sealed class ContentSync
{
    private static readonly JsonSerializerOptions Format = new() { WriteIndented = false };

    private readonly HttpClient http;
    private readonly AppPaths paths;

    public ContentSync(HttpClient http, AppPaths paths)
    {
        this.http = http;
        this.paths = paths;
    }

    public sealed record ManifestFile(
        [property: JsonPropertyName("path")] string Path,
        [property: JsonPropertyName("sha256")] string Sha256,
        [property: JsonPropertyName("size")] long Size);

    public sealed record ManifestCourse(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("version")] string Version,
        [property: JsonPropertyName("files")] IReadOnlyList<ManifestFile> Files);

    public sealed record Manifest(
        [property: JsonPropertyName("courses")] IReadOnlyList<ManifestCourse> Courses,
        [property: JsonPropertyName("totalBytes")] long TotalBytes);

    public sealed record Result(int Downloaded, int Kept, long Bytes);

    private string LocalManifestFile => System.IO.Path.Combine(paths.ContentDir, ".manifest.json");

    /// <summary>
    /// Fetches whatever this computer lacks. Throws only when the platform answered badly; no internet
    /// is not an error here — the caller carries on with the copy it already has.
    /// </summary>
    public async Task<Result> SyncAsync(HostConfig config, CancellationToken token)
    {
        if (!config.IsPaired)
        {
            return new Result(0, 0, 0);
        }

        var baseUrl = Platform.Normalize(config.PlatformUrl!);
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}/api/content/manifest");
        request.Headers.TryAddWithoutValidation("Authorization", $"Device {config.DeviceToken}");
        using var response = await http.SendAsync(request, token).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        var manifest =
            await response.Content.ReadFromJsonAsync<Manifest>(token).ConfigureAwait(false)
            ?? throw new InvalidOperationException("Платформа прислала пустую опись материалов.");

        var have = ReadLocalManifest();
        var downloaded = 0;
        var kept = 0;
        long bytes = 0;
        foreach (var course in manifest.Courses)
        {
            foreach (var file in course.Files)
            {
                token.ThrowIfCancellationRequested();
                var target = System.IO.Path.Combine(
                    paths.ContentDir,
                    file.Path.Replace('/', System.IO.Path.DirectorySeparatorChar));
                if (IsUpToDate(target, file, have))
                {
                    kept++;
                    continue;
                }

                await DownloadAsync(baseUrl, config, file, target, token).ConfigureAwait(false);
                downloaded++;
                bytes += file.Size;
            }
        }

        File.WriteAllText(LocalManifestFile, JsonSerializer.Serialize(manifest, Format));
        return new Result(downloaded, kept, bytes);
    }

    private bool IsUpToDate(string target, ManifestFile file, IReadOnlyDictionary<string, string> have)
    {
        if (!File.Exists(target))
        {
            return false;
        }

        // The recorded hash is trusted while the file's size still matches: hashing 7 MB on every start
        // would cost more than it is worth on a slow school computer.
        return have.TryGetValue(file.Path, out var known)
            && known == file.Sha256
            && new FileInfo(target).Length == file.Size;
    }

    private async Task DownloadAsync(
        string baseUrl,
        HostConfig config,
        ManifestFile file,
        string target,
        CancellationToken token)
    {
        var url = $"{baseUrl}/api/content/file?path={Uri.EscapeDataString(file.Path)}";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("Authorization", $"Device {config.DeviceToken}");
        using var response = await http.SendAsync(request, token).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        var bytes = await response.Content.ReadAsByteArrayAsync(token).ConfigureAwait(false);
        if (Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() != file.Sha256)
        {
            throw new InvalidOperationException($"Файл «{file.Path}» пришёл повреждённым.");
        }

        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(target)!);
        // Written beside the target and moved into place, so a broken connection never leaves half a file.
        var temporary = $"{target}.part";
        await File.WriteAllBytesAsync(temporary, bytes, token).ConfigureAwait(false);
        File.Move(temporary, target, overwrite: true);
    }

    private Dictionary<string, string> ReadLocalManifest()
    {
        var known = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!File.Exists(LocalManifestFile))
        {
            return known;
        }

        try
        {
            var saved = JsonSerializer.Deserialize<Manifest>(File.ReadAllText(LocalManifestFile));
            foreach (var course in saved?.Courses ?? [])
            {
                foreach (var file in course.Files)
                {
                    known[file.Path] = file.Sha256;
                }
            }
        }
        catch (Exception error) when (error is JsonException or IOException)
        {
            // An unreadable list only means everything is fetched again.
        }

        return known;
    }
}
