import { describe, expect, it } from 'vitest';
import { encodeFrame, parseFrame, REFERENCE_FRAME_HEX } from '../src/index.js';

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const reference = {
  keyframe: true,
  epoch: 7,
  seq: 42,
  width: 1280,
  height: 720,
  cursor: { x: 100, y: 200 },
  rects: [
    { x: 0, y: 0, w: 80, h: 80, jpeg: new Uint8Array([1, 2, 3]) },
    { x: 80, y: 16, w: 64, h: 40, jpeg: new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]) },
  ],
};

describe('screen broadcast frames (H14)', () => {
  it('writes the reference frame byte for byte, as the classroom app does in C#', () => {
    expect(hex(encodeFrame(reference))).toBe(REFERENCE_FRAME_HEX);
  });

  it('reads it back', () => {
    const frame = parseFrame(encodeFrame(reference));
    expect(frame).toMatchObject({
      keyframe: true,
      epoch: 7,
      seq: 42,
      width: 1280,
      height: 720,
      cursor: { x: 100, y: 200 },
    });
    expect(frame?.rects.map((r) => [r.x, r.y, r.w, r.h, r.length])).toEqual([
      [0, 0, 80, 80, 3],
      [80, 16, 64, 40, 4],
    ]);
  });

  it('refuses what would make a page draw outside its canvas or read past the message', () => {
    const ok = encodeFrame(reference);
    const broken = (edit: (b: Uint8Array, v: DataView) => void): Uint8Array => {
      const b = ok.slice();
      edit(b, new DataView(b.buffer));
      return b;
    };
    expect(parseFrame(broken((b) => (b[0] = 0)))).toBeNull(); // magic
    expect(parseFrame(broken((_b, v) => v.setUint8(4, 2)))).toBeNull(); // version
    expect(parseFrame(broken((_b, v) => v.setUint16(14, 1920, true)))).toBeNull(); // too wide
    expect(parseFrame(broken((_b, v) => v.setUint16(24 + 4, 2000, true)))).toBeNull(); // rect outside
    expect(parseFrame(broken((_b, v) => v.setUint32(24 + 8, 9999, true)))).toBeNull(); // length past end
    expect(parseFrame(ok.slice(0, ok.length - 1))).toBeNull(); // cut short
    expect(parseFrame(new Uint8Array([...ok, 0]))).toBeNull(); // trailing bytes
    expect(parseFrame(encodeFrame({ ...reference, cursor: null }))?.cursor).toBeNull();
  });
});
