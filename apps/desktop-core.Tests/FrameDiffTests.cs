using Sinf.Desktop.Core;
using Xunit;

namespace Sinf.Desktop.Core.Tests;

public class FrameDiffTests
{
    private const int Size = FrameDiff.FingerprintWidth * FrameDiff.FingerprintHeight;

    private static byte[] Flat(byte value) => Enumerable.Repeat(value, Size).ToArray();

    [Fact]
    public void The_first_frame_always_counts()
    {
        Assert.True(FrameDiff.HasChanged([], Flat(10)));
    }

    [Fact]
    public void A_still_screen_sends_nothing()
    {
        Assert.False(FrameDiff.HasChanged(Flat(100), Flat(100)));
    }

    [Fact]
    public void A_blinking_cursor_does_not_count()
    {
        var next = Flat(100);
        next[5] = 255;
        Assert.False(FrameDiff.HasChanged(Flat(100), next));
    }

    [Fact]
    public void A_new_drawing_counts()
    {
        var next = Flat(100);
        for (var i = 0; i < Size / 4; i++) next[i] = 20;
        Assert.True(FrameDiff.HasChanged(Flat(100), next));
    }

    [Theory]
    [InlineData(1366, 768, 320, 320, 180)]
    [InlineData(1920, 1080, 1920, 1920, 1080)]
    [InlineData(2560, 1440, 1920, 1920, 1080)]
    [InlineData(1024, 768, 320, 320, 240)]
    [InlineData(300, 200, 320, 300, 200)]
    public void Pictures_shrink_keeping_proportions(int w, int h, int max, int ew, int eh)
    {
        Assert.Equal((ew, eh), FrameDiff.Fit(w, h, max));
    }
}
