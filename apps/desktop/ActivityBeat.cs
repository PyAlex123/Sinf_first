using Sinf.Desktop.Core;

namespace Sinf.Desktop;

/// <summary>
/// Sinf's mark for the updater (B6, ADR-023): every minute, and whenever a lesson begins or ends,
/// <c>%LOCALAPPDATA%\Sinf\activity.json</c> says where this computer's lesson server is and whether a
/// child is in a lesson. The updater runs as SYSTEM, outside every session, and reads it from each
/// profile; a mark older than three minutes means Sinf is not running.
/// </summary>
internal sealed class ActivityBeat : IDisposable
{
    private readonly string file;
    private readonly Func<Activity> now;
    private readonly System.Threading.Timer timer;

    public ActivityBeat(AppPaths paths, Func<Activity> now)
    {
        file = Path.Combine(paths.Data, "activity.json");
        this.now = now;
        timer = new System.Threading.Timer(_ => Write(), null, TimeSpan.Zero, TimeSpan.FromMinutes(1));
    }

    /// <summary>Right away, not at the next minute: the updater must not catch a lesson unmarked.</summary>
    public void Write()
    {
        try
        {
            var temp = file + ".tmp";
            File.WriteAllText(temp, Updates.ToJson(now()));
            File.Move(temp, file, overwrite: true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            // The next beat tries again.
        }
    }

    public void Dispose()
    {
        timer.Dispose();
        try
        {
            // Closed on purpose: nothing of this Sinf is running any more.
            File.Delete(file);
        }
        catch (IOException)
        {
        }
    }
}
