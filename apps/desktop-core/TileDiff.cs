namespace Sinf.Desktop.Core;

/// <summary>A changed part of the screen, in pixels.</summary>
public readonly record struct DirtyRect(int X, int Y, int Width, int Height);

/// <summary>
/// Which parts of the screen changed since the last frame (stage 3, H14; ADR-017). The picture is cut
/// into tiles of 80×80; each tile keeps a hash of its pixels, so no previous frame is held in memory.
/// Changed tiles are joined into a few rectangles; when there would be too many, one rectangle around
/// them all is sent instead — a JPEG per rectangle costs more than a slightly bigger picture.
/// </summary>
public sealed class TileDiff
{
    public const int TileSize = 80;
    public const int MaxRects = 8;

    private ulong[] hashes = [];
    private int width;
    private int height;

    /// <summary>The changed rectangles of a frame given as raw pixels (any format with a fixed size per pixel).</summary>
    /// <param name="pixels">Rows of pixels, <paramref name="stride"/> bytes apart.</param>
    /// <param name="bytesPerPixel">3 for 24-bit, 4 for 32-bit.</param>
    /// <param name="forceAll">A keyframe: everything counts as changed.</param>
    public IReadOnlyList<DirtyRect> Compare(
        ReadOnlySpan<byte> pixels,
        int frameWidth,
        int frameHeight,
        int stride,
        int bytesPerPixel,
        bool forceAll = false)
    {
        var cols = (frameWidth + TileSize - 1) / TileSize;
        var rows = (frameHeight + TileSize - 1) / TileSize;
        var resized = frameWidth != width || frameHeight != height || hashes.Length != cols * rows;
        if (resized)
        {
            width = frameWidth;
            height = frameHeight;
            hashes = new ulong[cols * rows];
        }

        var dirty = new bool[cols * rows];
        var any = false;
        for (var ty = 0; ty < rows; ty++)
        {
            for (var tx = 0; tx < cols; tx++)
            {
                var hash = HashTile(pixels, tx, ty, stride, bytesPerPixel);
                var index = ty * cols + tx;
                if (forceAll || resized || hashes[index] != hash)
                {
                    dirty[index] = true;
                    any = true;
                }

                hashes[index] = hash;
            }
        }

        return any ? Merge(dirty, cols, rows) : [];
    }

    /// <summary>Forget the last frame: the next comparison sends everything.</summary>
    public void Reset() => hashes = [];

    private ulong HashTile(ReadOnlySpan<byte> pixels, int tx, int ty, int stride, int bytesPerPixel)
    {
        // FNV-1a over the tile's rows: cheap, and a change of one pixel changes the hash.
        const ulong prime = 1099511628211;
        var hash = 14695981039346656037;
        var x0 = tx * TileSize;
        var y0 = ty * TileSize;
        var w = Math.Min(TileSize, width - x0) * bytesPerPixel;
        var y1 = Math.Min(y0 + TileSize, height);
        for (var y = y0; y < y1; y++)
        {
            var row = pixels.Slice(y * stride + x0 * bytesPerPixel, w);
            // Eight bytes at a time; the tail byte by byte.
            var i = 0;
            for (; i + 8 <= row.Length; i += 8)
            {
                hash = (hash ^ BitConverter.ToUInt64(row.Slice(i, 8))) * prime;
            }

            for (; i < row.Length; i++)
            {
                hash = (hash ^ row[i]) * prime;
            }
        }

        return hash;
    }

    /// <summary>Runs of changed tiles in each row, then runs with the same columns stacked into rectangles.</summary>
    internal IReadOnlyList<DirtyRect> Merge(bool[] dirty, int cols, int rows)
    {
        var open = new List<(int Col0, int Col1, int Row0, int Row1)>();
        var done = new List<(int Col0, int Col1, int Row0, int Row1)>();
        for (var r = 0; r < rows; r++)
        {
            var runs = new List<(int, int)>();
            for (var c = 0; c < cols; c++)
            {
                if (!dirty[r * cols + c])
                {
                    continue;
                }

                var start = c;
                while (c + 1 < cols && dirty[r * cols + c + 1])
                {
                    c++;
                }

                runs.Add((start, c));
            }

            var next = new List<(int, int, int, int)>();
            foreach (var (c0, c1) in runs)
            {
                var match = open.FindIndex(o => o.Col0 == c0 && o.Col1 == c1 && o.Row1 == r - 1);
                if (match >= 0)
                {
                    var o = open[match];
                    open.RemoveAt(match);
                    next.Add((c0, c1, o.Row0, r));
                }
                else
                {
                    next.Add((c0, c1, r, r));
                }
            }

            done.AddRange(open);
            open = next;
        }

        done.AddRange(open);
        var rects = done.Select(ToPixels).ToList();
        if (rects.Count <= MaxRects)
        {
            return rects;
        }

        var x0 = rects.Min(r => r.X);
        var y0 = rects.Min(r => r.Y);
        var x1 = rects.Max(r => r.X + r.Width);
        var y1 = rects.Max(r => r.Y + r.Height);
        return [new DirtyRect(x0, y0, x1 - x0, y1 - y0)];
    }

    private DirtyRect ToPixels((int Col0, int Col1, int Row0, int Row1) t)
    {
        var x = t.Col0 * TileSize;
        var y = t.Row0 * TileSize;
        return new DirtyRect(
            x,
            y,
            Math.Min((t.Col1 + 1) * TileSize, width) - x,
            Math.Min((t.Row1 + 1) * TileSize, height) - y);
    }
}
