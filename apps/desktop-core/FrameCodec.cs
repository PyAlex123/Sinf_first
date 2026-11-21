using System.Buffers.Binary;

namespace Sinf.Desktop.Core;

/// <summary>One changed rectangle and its picture.</summary>
public sealed record FramePart(int X, int Y, int Width, int Height, byte[] Jpeg);

/// <summary>
/// The binary frame of a screen broadcast (stage 3, H14; ADR-017). The layout is described once, in
/// <c>packages/shared/src/screen.ts</c>; both sides are pinned by the same reference frame in their tests.
/// </summary>
public static class FrameCodec
{
    public const int HeaderBytes = 24;
    public const int RectHeaderBytes = 12;
    public const int MaxFrameBytes = 1024 * 1024;
    public const int MaxWidth = 1280;
    public const int MaxHeight = 720;

    public static byte[] Encode(
        bool keyframe,
        uint epoch,
        uint seq,
        int width,
        int height,
        (int X, int Y)? cursor,
        IReadOnlyList<FramePart> parts)
    {
        var size = HeaderBytes + parts.Sum(p => RectHeaderBytes + p.Jpeg.Length);
        var bytes = new byte[size];
        var span = bytes.AsSpan();
        "SNF1"u8.CopyTo(span);
        span[4] = 1;
        span[5] = (byte)(keyframe ? 1 : 0);
        BinaryPrimitives.WriteUInt32LittleEndian(span[6..], epoch);
        BinaryPrimitives.WriteUInt32LittleEndian(span[10..], seq);
        BinaryPrimitives.WriteUInt16LittleEndian(span[14..], (ushort)width);
        BinaryPrimitives.WriteUInt16LittleEndian(span[16..], (ushort)height);
        BinaryPrimitives.WriteInt16LittleEndian(span[18..], (short)(cursor?.X ?? -1));
        BinaryPrimitives.WriteInt16LittleEndian(span[20..], (short)(cursor?.Y ?? -1));
        BinaryPrimitives.WriteUInt16LittleEndian(span[22..], (ushort)parts.Count);
        var at = HeaderBytes;
        foreach (var p in parts)
        {
            BinaryPrimitives.WriteUInt16LittleEndian(span[at..], (ushort)p.X);
            BinaryPrimitives.WriteUInt16LittleEndian(span[(at + 2)..], (ushort)p.Y);
            BinaryPrimitives.WriteUInt16LittleEndian(span[(at + 4)..], (ushort)p.Width);
            BinaryPrimitives.WriteUInt16LittleEndian(span[(at + 6)..], (ushort)p.Height);
            BinaryPrimitives.WriteUInt32LittleEndian(span[(at + 8)..], (uint)p.Jpeg.Length);
            at += RectHeaderBytes;
            p.Jpeg.CopyTo(span[at..]);
            at += p.Jpeg.Length;
        }

        return bytes;
    }
}
