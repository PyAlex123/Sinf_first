using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using Sinf.Desktop.Core;

namespace Sinf.Desktop;

/// <summary>
/// Films this computer's screen for the class (stage 3, H14; ADR-017): "Мой экран" on the teacher's
/// computer, "Экран ученика" on a child's. A few times a second the primary screen is captured, cut
/// down to at most 1280×720, compared with the last frame by tiles, and only the changed parts are
/// sent — each as a JPEG — over a WebSocket to the lesson server, which passes them to every viewer.
/// The server asks for a whole picture ("keyframe") when a viewer starts or falls behind.
/// </summary>
internal sealed class ScreenShare : IAsyncDisposable
{
    private readonly ClientWebSocket socket = new();
    private readonly CancellationTokenSource stop = new();
    private readonly TileDiff diff = new();
    private readonly SharePacer pacer = new();
    private readonly Uri address;
    private volatile bool keyframeWanted = true;
    private Task? loop;
    private Task? listen;
    private uint seq;

    private static readonly ImageCodecInfo Jpeg =
        ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);

    /// <param name="address">ws://…/ws/demo?session=… (plus the child's lesson token, on a child's computer).</param>
    /// <param name="hostToken">The teacher's app's own secret for its server; null on a child's computer.</param>
    public ScreenShare(Uri address, string? hostToken)
    {
        this.address = address;
        socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(15);
        if (hostToken is not null)
        {
            socket.Options.SetRequestHeader("x-host-token", hostToken);
        }
    }

    /// <summary>Fired when the broadcast ended from the other side (stop, closed, lost).</summary>
    public event Action? Ended;

    public async Task StartAsync()
    {
        await socket.ConnectAsync(address, stop.Token).ConfigureAwait(false);
        listen = Task.Run(ListenAsync);
        loop = Task.Run(FilmAsync);
    }

    private async Task ListenAsync()
    {
        var buffer = new byte[256];
        try
        {
            while (!stop.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                var result = await socket.ReceiveAsync(buffer, stop.Token).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    break;
                }

                var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
                if (text == "keyframe")
                {
                    keyframeWanted = true;
                }
                else if (text == "stop")
                {
                    break;
                }
            }
        }
        catch (Exception error) when (error is WebSocketException or OperationCanceledException or ObjectDisposedException)
        {
            // Closed: the broadcast is over.
        }

        await stop.CancelAsync().ConfigureAwait(false);
        Ended?.Invoke();
    }

    private async Task FilmAsync()
    {
        var clock = Stopwatch.StartNew();
        var screen = Screen.PrimaryScreen?.Bounds ?? new Rectangle(0, 0, 1366, 768);
        var (width, height) = Fit(screen.Width, screen.Height);
        using var grab = new Bitmap(screen.Width, screen.Height, PixelFormat.Format24bppRgb);
        using var frame = new Bitmap(width, height, PixelFormat.Format24bppRgb);
        var pixels = Array.Empty<byte>();
        while (!stop.IsCancellationRequested)
        {
            var started = clock.ElapsedMilliseconds;
            try
            {
                using (var g = Graphics.FromImage(grab))
                {
                    g.CopyFromScreen(screen.Location, Point.Empty, screen.Size, CopyPixelOperation.SourceCopy);
                }

                using (var g = Graphics.FromImage(frame))
                {
                    g.InterpolationMode = width == screen.Width ? InterpolationMode.NearestNeighbor : InterpolationMode.Bilinear;
                    g.DrawImage(grab, 0, 0, width, height);
                }

                int stride;
                var data = frame.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
                try
                {
                    stride = data.Stride;
                    var size = stride * height;
                    if (pixels.Length != size)
                    {
                        pixels = new byte[size];
                    }

                    Marshal.Copy(data.Scan0, pixels, 0, size);
                }
                finally
                {
                    frame.UnlockBits(data);
                }

                var key = keyframeWanted;
                keyframeWanted = false;
                var rects = diff.Compare(pixels, width, height, stride, 3, forceAll: key);
                if (rects.Count > 0)
                {
                    var quality = key ? pacer.KeyframeQuality : pacer.Quality;
                    var parts = rects.Select(r => new FramePart(r.X, r.Y, r.Width, r.Height, Encode(frame, r, quality))).ToList();
                    var cursor = Cursor.Position;
                    (int, int)? at = screen.Contains(cursor)
                        ? ((cursor.X - screen.X) * width / screen.Width, (cursor.Y - screen.Y) * height / screen.Height)
                        : null;
                    var bytes = FrameCodec.Encode(key, 0, seq++, width, height, at, parts);
                    if (bytes.Length <= FrameCodec.MaxFrameBytes)
                    {
                        await socket.SendAsync(bytes, WebSocketMessageType.Binary, true, stop.Token).ConfigureAwait(false);
                        pacer.Sent(bytes.Length, clock.ElapsedMilliseconds);
                    }
                }
            }
            catch (System.ComponentModel.Win32Exception)
            {
                // The secure desktop (UAC, Ctrl+Alt+Del) cannot be filmed: skip this frame.
                keyframeWanted = true;
            }
            catch (Exception error) when (error is WebSocketException or OperationCanceledException or ObjectDisposedException)
            {
                break;
            }

            var rest = pacer.IntervalMs - (int)(clock.ElapsedMilliseconds - started);
            if (rest > 0)
            {
                try
                {
                    await Task.Delay(rest, stop.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }
    }

    private static byte[] Encode(Bitmap frame, DirtyRect r, int quality)
    {
        using var piece = frame.Clone(new Rectangle(r.X, r.Y, r.Width, r.Height), PixelFormat.Format24bppRgb);
        using var stream = new MemoryStream();
        using var options = new EncoderParameters(1);
        options.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)quality);
        piece.Save(stream, Jpeg, options);
        return stream.ToArray();
    }

    /// <summary>CLAUDE.md §3.1: a broadcast is at most 1280×720; a smaller screen stays as it is.</summary>
    internal static (int Width, int Height) Fit(int width, int height)
    {
        var scale = Math.Min(1.0, Math.Min(FrameCodec.MaxWidth / (double)width, FrameCodec.MaxHeight / (double)height));
        return (Math.Max(1, (int)(width * scale)), Math.Max(1, (int)(height * scale)));
    }

    public async ValueTask DisposeAsync()
    {
        await stop.CancelAsync().ConfigureAwait(false);
        try
        {
            if (socket.State == WebSocketState.Open)
            {
                using var bye = new CancellationTokenSource(TimeSpan.FromSeconds(1));
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "stop", bye.Token).ConfigureAwait(false);
            }
        }
        catch (Exception error) when (error is WebSocketException or OperationCanceledException or ObjectDisposedException)
        {
            // Already gone.
        }

        foreach (var task in new[] { loop, listen })
        {
            if (task is not null)
            {
                try
                {
                    await task.ConfigureAwait(false);
                }
                catch (Exception error) when (error is WebSocketException or OperationCanceledException or ObjectDisposedException)
                {
                    // Already reported.
                }
            }
        }

        socket.Dispose();
        stop.Dispose();
    }
}
