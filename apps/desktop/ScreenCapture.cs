using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using Sinf.Desktop.Core;

namespace Sinf.Desktop;

/// <summary>
/// Photographs this computer's screen (stage 3, H5; CLAUDE.md §3.1, §4.8): thumbnails of 320 px and at
/// most 30 KB for the teacher's tiles, screenshots of up to 1920 px and 400 KB for the gallery.
/// Native capture needs no HTTPS and no permission prompt — what the browser could not do (S1.14).
/// </summary>
internal static class ScreenCapture
{
    public const int ThumbWidth = 320;
    public const int ThumbMaxBytes = 30 * 1024;
    public const int ShotWidth = 1920;
    public const int ShotMaxBytes = 400 * 1024;

    private static readonly ImageCodecInfo Jpeg =
        ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);

    public sealed record Picture(byte[] Jpeg, int Width, int Height);

    /// <summary>The whole primary screen, as it is now.</summary>
    public static Bitmap Grab()
    {
        var bounds = Screen.PrimaryScreen?.Bounds ?? new Rectangle(0, 0, 1366, 768);
        var bitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
        return bitmap;
    }

    /// <summary>A tiny grey copy of the screen, to tell whether anything changed (<see cref="FrameDiff"/>).</summary>
    public static byte[] Fingerprint(Bitmap screen)
    {
        using var small = Resize(screen, FrameDiff.FingerprintWidth, FrameDiff.FingerprintHeight);
        var grey = new byte[FrameDiff.FingerprintWidth * FrameDiff.FingerprintHeight];
        for (var y = 0; y < FrameDiff.FingerprintHeight; y++)
        {
            for (var x = 0; x < FrameDiff.FingerprintWidth; x++)
            {
                var c = small.GetPixel(x, y);
                grey[(y * FrameDiff.FingerprintWidth) + x] = (byte)((c.R * 3 + c.G * 6 + c.B) / 10);
            }
        }

        return grey;
    }

    /// <summary>Shrinks and encodes, lowering the quality until the picture fits the budget.</summary>
    public static Picture Encode(Bitmap screen, int maxWidth, int maxBytes)
    {
        var (width, height) = FrameDiff.Fit(screen.Width, screen.Height, maxWidth);
        using var sized = width == screen.Width ? (Bitmap)screen.Clone() : Resize(screen, width, height);
        byte[] bytes = [];
        foreach (var quality in new long[] { 80, 65, 50, 40, 30, 20 })
        {
            bytes = Save(sized, quality);
            if (bytes.Length <= maxBytes)
            {
                break;
            }
        }

        return new Picture(bytes, width, height);
    }

    private static Bitmap Resize(Bitmap source, int width, int height)
    {
        var target = new Bitmap(width, height, PixelFormat.Format24bppRgb);
        using var graphics = Graphics.FromImage(target);
        graphics.InterpolationMode = InterpolationMode.HighQualityBilinear;
        graphics.DrawImage(source, 0, 0, width, height);
        return target;
    }

    private static byte[] Save(Bitmap bitmap, long quality)
    {
        using var stream = new MemoryStream();
        using var parameters = new EncoderParameters(1);
        parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
        bitmap.Save(stream, Jpeg, parameters);
        return stream.ToArray();
    }
}
