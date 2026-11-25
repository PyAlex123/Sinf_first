using System.Security.Cryptography;

namespace Sinf.Desktop.Core;

/// <summary>A file of the child's folder as the lesson server has it.</summary>
public sealed record ServerFile(string Id, string Name, string Sha256, long Size);

/// <summary>A file in the working folder on this computer.</summary>
public sealed record LocalFile(string Name, string Sha256, long Size);

/// <summary>What to do to bring the working folder and the server together.</summary>
public abstract record FolderAction(string Name)
{
    /// <summary>Bring the server's version here.</summary>
    public sealed record Download(string Name, string FileId, string Sha256) : FolderAction(Name);

    /// <summary>Send this computer's version; <paramref name="BaseSha256"/> is the version it was made from.</summary>
    public sealed record Upload(string Name, string? BaseSha256) : FolderAction(Name);

    /// <summary>The child deleted it here: delete it there.</summary>
    public sealed record Delete(string Name, string FileId) : FolderAction(Name);
}

/// <summary>
/// The working folder of a lesson on a student computer (stage 3, H15; ADR-015): the child's
/// "Мои работы", brought from the teacher's computer when the lesson starts, sent back after every
/// save, and wiped when the lesson ends. The decisions are here, without Windows, and tested; the
/// folder itself is in <c>apps/desktop/WorkFolderSync.cs</c>.
/// </summary>
public static class WorkFolder
{
    /// <summary>
    /// Files that are not the child's work: Office's lock and temporary files, editors' backups.
    /// They are never sent.
    /// </summary>
    public static bool IsWork(string name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.StartsWith("~$", StringComparison.Ordinal) || name.StartsWith('.'))
        {
            return false;
        }

        var lower = name.ToLowerInvariant();
        if (lower.StartsWith("~wr", StringComparison.Ordinal) || lower.EndsWith(".tmp", StringComparison.Ordinal)
            || lower.EndsWith(".bak", StringComparison.Ordinal) || lower.EndsWith('~'))
        {
            return false;
        }

        // The server takes only these (packages/shared/src/files.ts, ALLOWED_EXTENSIONS).
        var dot = lower.LastIndexOf('.');
        return dot > 0 && Allowed.Contains(lower[(dot + 1)..]);
    }

    /// <summary>
    /// Arduino keeps a sketch in a folder of its own name — "blink.ino" must be "blink\blink.ino",
    /// or the IDE refuses to open it (stage 6, B5). The child's file is still "blink.ino": this is
    /// the folder it lives in on the student computer, or null for any other file.
    /// </summary>
    public static string? SketchFolder(string name)
    {
        if (!IsWork(name) || !name.EndsWith(".ino", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var stem = name[..^4];
        return stem.Length > 0 && stem.IndexOfAny(['\\', '/', ':']) < 0 && stem.Trim('.').Length > 0 ? stem : null;
    }

    private static readonly HashSet<string> Allowed =
    [
        "docx", "doc", "odt", "rtf", "txt", "pdf", "xlsx", "xls", "ods", "csv", "pptx", "ppt", "odp",
        "png", "jpg", "jpeg", "gif", "bmp", "webp", "html", "htm", "css", "py", "sb3", "ino",
    ];

    /// <summary>
    /// What to do, from three lists: what the server has, what is here now, and what was here after
    /// the last exchange (<paramref name="known"/>: name → content). Names are compared as Windows
    /// does — without letter case.
    /// </summary>
    public static IReadOnlyList<FolderAction> Plan(
        IReadOnlyList<ServerFile> server,
        IReadOnlyList<LocalFile> local,
        IReadOnlyDictionary<string, string> known)
    {
        var comparer = StringComparer.OrdinalIgnoreCase;
        var serverBy = server.ToDictionary(f => f.Name, comparer);
        var localBy = local.Where(f => IsWork(f.Name)).ToDictionary(f => f.Name, comparer);
        var knownBy = new Dictionary<string, string>(known, comparer);
        var actions = new List<FolderAction>();

        foreach (var file in localBy.Values)
        {
            knownBy.TryGetValue(file.Name, out var was);
            serverBy.TryGetValue(file.Name, out var there);
            if (file.Sha256 == was)
            {
                // Unchanged here; the server may have a newer version (from home, from another PC).
                if (there is not null && there.Sha256 != file.Sha256)
                {
                    actions.Add(new FolderAction.Download(file.Name, there.Id, there.Sha256));
                }

                continue;
            }

            if (there?.Sha256 == file.Sha256)
            {
                continue; // Already the same there.
            }

            // Changed here (or new): send it, saying which version it was made from. If the server
            // moved on meanwhile, it keeps both (ADR-015).
            actions.Add(new FolderAction.Upload(file.Name, was));
        }

        foreach (var there in serverBy.Values)
        {
            if (localBy.ContainsKey(there.Name))
            {
                continue;
            }

            if (knownBy.TryGetValue(there.Name, out var was) && was == there.Sha256)
            {
                // It was here and the child deleted it.
                actions.Add(new FolderAction.Delete(there.Name, there.Id));
            }
            else
            {
                actions.Add(new FolderAction.Download(there.Name, there.Id, there.Sha256));
            }
        }

        return actions;
    }

    public static string Sha256Of(Stream stream) => Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
}
