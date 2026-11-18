using System.Security.Cryptography;
using System.Text.Json;

namespace Sinf.Desktop;

/// <summary>
/// Where the app keeps its parts and its data. The program folder stays read-only (it may sit on a flash
/// drive or under Program Files), so the database, logs and WebView2 profile live in %LOCALAPPDATA%\Sinf.
/// </summary>
internal sealed class AppPaths
{
    private AppPaths(string root, string data)
    {
        Root = root;
        Data = data;
    }

    /// <summary>Folder that holds Sinf.exe.</summary>
    public string Root { get; }

    /// <summary>%LOCALAPPDATA%\Sinf — database, logs, WebView2 profile, host settings.</summary>
    public string Data { get; }

    public string NodeExe => Path.Combine(Root, "server", "node.exe");

    public string ServerDir => Path.Combine(Root, "server");

    public string ServerEntry => Path.Combine(Root, "server", "dist", "index.js");

    public string WebDir => Path.Combine(Root, "web");

    /// <summary>Lessons that came inside the archive: a reserve for a computer that has never been online.</summary>
    public string BundledContentDir => Path.Combine(Root, "content");

    /// <summary>The copy the server actually reads, kept up to date from the platform (S2.5).</summary>
    public string ContentDir => Path.Combine(Data, "content");

    public string DatabasePath => Path.Combine(Data, "sinf.db");

    public string WebViewDir => Path.Combine(Data, "webview");

    public string LogFile => Path.Combine(Data, "logs", "server.log");

    public string ConfigFile => Path.Combine(Data, "config.json");

    public static AppPaths Create()
    {
        var root = AppContext.BaseDirectory;
        var data = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Sinf");
        var paths = new AppPaths(root, data);
        Directory.CreateDirectory(paths.Data);
        Directory.CreateDirectory(Path.GetDirectoryName(paths.LogFile)!);
        paths.SeedContentFromPackage();
        return paths;
    }

    /// <summary>
    /// On the very first run the working copy is empty, so the lessons from the archive are put there.
    /// That way a computer that has never seen the internet can hold a lesson straight away (S2.5).
    /// </summary>
    private void SeedContentFromPackage()
    {
        if (Directory.Exists(ContentDir))
        {
            return;
        }

        // The server refuses to start without the folder, so it exists even when there is nothing to copy.
        Directory.CreateDirectory(ContentDir);
        if (!Directory.Exists(BundledContentDir))
        {
            return;
        }

        foreach (var source in Directory.EnumerateFiles(BundledContentDir, "*", SearchOption.AllDirectories))
        {
            var target = Path.Combine(ContentDir, Path.GetRelativePath(BundledContentDir, source));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(source, target, overwrite: true);
        }
    }

    /// <summary>Names the first missing part of the package, or null when everything is in place.</summary>
    public string? FindMissingPart()
    {
        if (!File.Exists(NodeExe)) return NodeExe;
        if (!File.Exists(ServerEntry)) return ServerEntry;
        if (!Directory.Exists(WebDir)) return WebDir;
        // The working copy of the lessons is ours to create; the archive only has to carry the reserve.
        if (!Directory.Exists(BundledContentDir)) return BundledContentDir;
        return null;
    }
}

/// <summary>
/// Settings kept between runs. The first two values are generated on the first start: the session secret
/// signs cookies, the teacher password is shown in the window, because the demo account needs one to log
/// in. The last two appear when the school pairs this computer with the platform (S2.4).
/// </summary>
internal sealed record HostConfig(
    string SessionSecret,
    string TeacherPassword,
    string? PlatformUrl = null,
    string? DeviceToken = null)
{
    private static readonly JsonSerializerOptions Format = new() { WriteIndented = true };

    /// <summary>Letters and digits that cannot be confused with one another when read off a screen.</summary>
    private const string PasswordAlphabet = "abcdefghijkmnpqrstuvwxyz23456789";

    public static HostConfig Load(AppPaths paths)
    {
        if (File.Exists(paths.ConfigFile))
        {
            try
            {
                var saved = JsonSerializer.Deserialize<HostConfig>(File.ReadAllText(paths.ConfigFile));
                if (saved is { SessionSecret.Length: >= 16, TeacherPassword.Length: >= 6 })
                {
                    return saved;
                }
            }
            catch (Exception error) when (error is JsonException or IOException)
            {
                // Unreadable settings are replaced below rather than stopping the app.
            }
        }

        var created = new HostConfig(RandomSecret(48), RandomPassword(8));
        Save(paths, created);
        return created;
    }

    public static void Save(AppPaths paths, HostConfig config)
    {
        File.WriteAllText(paths.ConfigFile, JsonSerializer.Serialize(config, Format));
    }

    /// <summary>Is this computer attached to a school on the platform?</summary>
    public bool IsPaired => !string.IsNullOrWhiteSpace(PlatformUrl) && !string.IsNullOrWhiteSpace(DeviceToken);

    private static string RandomSecret(int length)
    {
        var bytes = RandomNumberGenerator.GetBytes(length);
        return Convert.ToHexString(bytes);
    }

    private static string RandomPassword(int length)
    {
        return RandomNumberGenerator.GetString(PasswordAlphabet, length);
    }
}
