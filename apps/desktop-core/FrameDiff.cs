namespace Sinf.Desktop.Core;

/// <summary>
/// Is the screen any different from the last thumbnail? (stage 3, H5; CLAUDE.md §3.1: a thumbnail is
/// sent only when the picture changed.) The app shrinks the screen to a tiny grey image — the
/// fingerprint — and compares it with the previous one. A blinking cursor or a clock does not count.
/// </summary>
public static class FrameDiff
{
    public const int FingerprintWidth = 32;
    public const int FingerprintHeight = 18;

    /// <summary>Average change per fingerprint pixel (0–255) above which the screen counts as changed.</summary>
    public const double Threshold = 2.0;

    public static bool HasChanged(ReadOnlySpan<byte> previous, ReadOnlySpan<byte> next)
    {
        if (previous.Length == 0 || previous.Length != next.Length)
        {
            return true;
        }

        long sum = 0;
        for (var i = 0; i < next.Length; i++)
        {
            sum += Math.Abs(next[i] - previous[i]);
        }

        return (double)sum / next.Length > Threshold;
    }

    /// <summary>The size of a picture no wider than <paramref name="maxWidth"/>, proportions kept, never enlarged.</summary>
    public static (int Width, int Height) Fit(int width, int height, int maxWidth)
    {
        if (width <= 0 || height <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(width), "A picture has a size.");
        }

        if (width <= maxWidth)
        {
            return (width, height);
        }

        var h = (int)Math.Round((double)height * maxWidth / width);
        return (maxWidth, Math.Max(1, h));
    }
}
