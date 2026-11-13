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

    public string ContentDir => Path.Combine(Root, "content");

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
        return paths;
    }

    /// <summary>Names the first missing part of the package, or null when everything is in place.</summary>
    public string? FindMissingPart()
    {
        if (!File.Exists(NodeExe)) return NodeExe;
        if (!File.Exists(ServerEntry)) return ServerEntry;
        if (!Directory.Exists(WebDir)) return WebDir;
        if (!Directory.Exists(ContentDir)) return ContentDir;
        return null;
    }
}

/// <summary>
/// Settings kept between runs. Both values are generated on the first start: the session secret signs
/// cookies, the teacher password is shown in the window, because the demo account needs one to log in.
/// </summary>
internal sealed record HostConfig(string SessionSecret, string TeacherPassword)
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
        File.WriteAllText(paths.ConfigFile, JsonSerializer.Serialize(created, Format));
        return created;
    }

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
