namespace Sinf.Desktop.Core;

/// <summary>
/// How often and how well to send the screen (stage 3, H14; ADR-017). The budget is bytes per second
/// for one viewer — the lesson server passes each frame to every child, so thirty viewers make thirty
/// times that on the classroom network. When a second's worth went over budget, the pacer first slows
/// down (5 frames a second down to 2), then lowers JPEG quality; when there is room, it goes back.
/// </summary>
public sealed class SharePacer
{
    public const int MaxFps = 5;
    public const int MinFps = 2;
    public const int MaxQuality = 70;
    public const int MinQuality = 35;

    private readonly int budgetBytesPerSecond;
    private readonly Queue<(long At, int Bytes)> window = new();
    private long windowBytes;

    /// <param name="budgetBytesPerSecond">About 100 KB/s by default: 30 viewers stay near a third of a 100 Mbit network.</param>
    public SharePacer(int budgetBytesPerSecond = 100 * 1024)
    {
        this.budgetBytesPerSecond = budgetBytesPerSecond;
    }

    public int Fps { get; private set; } = MaxFps;

    public int Quality { get; private set; } = 60;

    public int IntervalMs => 1000 / Fps;

    /// <summary>A frame of <paramref name="bytes"/> was sent at <paramref name="nowMs"/>.</summary>
    public void Sent(int bytes, long nowMs)
    {
        window.Enqueue((nowMs, bytes));
        windowBytes += bytes;
        while (window.Count > 0 && window.Peek().At <= nowMs - 1000)
        {
            windowBytes -= window.Dequeue().Bytes;
        }

        if (windowBytes > budgetBytesPerSecond)
        {
            if (Fps > MinFps)
            {
                Fps--;
            }
            else if (Quality > MinQuality)
            {
                Quality = Math.Max(MinQuality, Quality - 10);
            }
        }
        else if (windowBytes < budgetBytesPerSecond / 2)
        {
            if (Quality < 60)
            {
                Quality = Math.Min(60, Quality + 5);
            }
            else if (Fps < MaxFps)
            {
                Fps++;
            }
        }
    }

    /// <summary>A keyframe ignores the budget once: the viewer needs the whole picture.</summary>
    public int KeyframeQuality => Math.Max(MinQuality, Quality - 10);
}
