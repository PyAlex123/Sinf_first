using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

public class ScreenShareTests
{
    private const int W = 400;
    private const int H = 240;
    private const int Bpp = 3;

    private static byte[] Blank() => new byte[W * H * Bpp];

    private static void Paint(byte[] pixels, int x, int y, byte value)
    {
        pixels[(y * W + x) * Bpp] = value;
    }

    [Fact]
    public void The_first_frame_and_a_keyframe_are_the_whole_screen()
    {
        var diff = new TileDiff();
        var rects = diff.Compare(Blank(), W, H, W * Bpp, Bpp);
        Assert.Equal([new DirtyRect(0, 0, W, H)], rects);
        Assert.Empty(diff.Compare(Blank(), W, H, W * Bpp, Bpp));
        Assert.Equal([new DirtyRect(0, 0, W, H)], diff.Compare(Blank(), W, H, W * Bpp, Bpp, forceAll: true));
    }

    [Fact]
    public void One_changed_pixel_sends_its_tile_only()
    {
        var diff = new TileDiff();
        diff.Compare(Blank(), W, H, W * Bpp, Bpp);
        var next = Blank();
        Paint(next, 170, 90, 255); // tile (2, 1)
        Assert.Equal([new DirtyRect(160, 80, 80, 80)], diff.Compare(next, W, H, W * Bpp, Bpp));
    }

    [Fact]
    public void Neighbouring_tiles_join_into_one_rectangle_and_edges_are_cut_to_the_screen()
    {
        var diff = new TileDiff();
        diff.Compare(Blank(), W, H, W * Bpp, Bpp);
        var next = Blank();
        // A 2×2 block of tiles in the corner, and one tile at the bottom right edge (partial).
        Paint(next, 5, 5, 1);
        Paint(next, 85, 5, 1);
        Paint(next, 5, 85, 1);
        Paint(next, 85, 85, 1);
        Paint(next, 399, 239, 1);
        var rects = diff.Compare(next, W, H, W * Bpp, Bpp);
        Assert.Contains(new DirtyRect(0, 0, 160, 160), rects);
        Assert.Contains(new DirtyRect(320, 160, 80, 80), rects);
        Assert.Equal(2, rects.Count);
    }

    [Fact]
    public void Too_many_pieces_become_one_rectangle_around_them()
    {
        // A wider screen, 8×3 tiles, with a checkerboard of changes: twelve pieces, none joins.
        const int wide = 640;
        var diff = new TileDiff();
        diff.Compare(new byte[wide * H * Bpp], wide, H, wide * Bpp, Bpp);
        var next = new byte[wide * H * Bpp];
        for (var ty = 0; ty < 3; ty++)
        {
            for (var tx = 0; tx < 8; tx++)
            {
                if ((tx + ty) % 2 == 0)
                {
                    next[((ty * 80 + 1) * wide + tx * 80 + 1) * Bpp] = 9;
                }
            }
        }

        Assert.Equal([new DirtyRect(0, 0, wide, H)], diff.Compare(next, wide, H, wide * Bpp, Bpp));
    }

    [Fact]
    public void Writes_the_reference_frame_byte_for_byte_as_the_page_reads_it()
    {
        var bytes = FrameCodec.Encode(
            keyframe: true,
            epoch: 7,
            seq: 42,
            width: 1280,
            height: 720,
            cursor: (100, 200),
            [new FramePart(0, 0, 80, 80, [1, 2, 3]), new FramePart(80, 16, 64, 40, [0xaa, 0xbb, 0xcc, 0xdd])]);
        // packages/shared/src/screen.ts, REFERENCE_FRAME_HEX.
        Assert.Equal(
            "534e46310101070000002a0000000005d0026400c8000200000000005000500003000000010203500010004000280004000000aabbccdd",
            Convert.ToHexString(bytes).ToLowerInvariant());
    }

    [Fact]
    public void The_pacer_slows_down_first_then_lowers_quality_and_comes_back()
    {
        var pacer = new SharePacer(budgetBytesPerSecond: 100_000);
        Assert.Equal((5, 60), (pacer.Fps, pacer.Quality));
        long t = 0;
        for (var i = 0; i < 10; i++, t += 200)
        {
            pacer.Sent(60_000, t);
        }

        Assert.Equal(SharePacer.MinFps, pacer.Fps);
        Assert.True(pacer.Quality < 60);
        Assert.True(pacer.Quality >= SharePacer.MinQuality);

        // A quiet screen: tiny frames; quality comes back first, then speed.
        for (var i = 0; i < 40; i++, t += 200)
        {
            pacer.Sent(2_000, t);
        }

        Assert.Equal((SharePacer.MaxFps, 60), (pacer.Fps, pacer.Quality));
    }
}
