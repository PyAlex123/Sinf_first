/**
 * A frame of a screen broadcast — "Мой экран" and "Экран ученика" (CLAUDE.md §4.4; PLAN.md
 * 7.5–7.6; stage 3, H14; ADR-017). The classroom app captures the screen, keeps only the parts
 * that changed and sends them as one binary WebSocket message; the lesson server checks the header
 * and passes the bytes on unchanged; the page draws them on a canvas.
 *
 * Layout, little-endian (the C# writer is `apps/desktop-core/FrameCodec.cs`; both are pinned by the
 * same reference frame in their tests):
 *
 *   0  "SNF1"           magic
 *   4  u8  version      1
 *   5  u8  flags        bit 0: keyframe — the whole screen, a viewer may start here
 *   6  u32 epoch        changes with every new broadcast; frames of an old one are dropped
 *  10  u32 seq          frame number within the broadcast
 *  14  u16 width        of the whole picture
 *  16  u16 height
 *  18  i16 cursorX      -1 when the cursor is not on the picture
 *  20  i16 cursorY
 *  22  u16 rectCount
 *  24  rects: u16 x, u16 y, u16 w, u16 h, u32 length — then `length` bytes of JPEG — repeated
 */

export const FRAME_MAGIC = [0x53, 0x4e, 0x46, 0x31] as const;
export const FRAME_VERSION = 1;
export const FRAME_HEADER_BYTES = 24;
export const FRAME_RECT_HEADER_BYTES = 12;
/** A broadcast frame is at most this big: a whole 1280×720 JPEG fits many times over. */
export const MAX_FRAME_BYTES = 1024 * 1024;
export const MAX_FRAME_RECTS = 64;
/** CLAUDE.md §3.1: a broadcast is at most 1280×720. */
export const MAX_FRAME_WIDTH = 1280;
export const MAX_FRAME_HEIGHT = 720;

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Offset of the JPEG bytes in the message. */
  offset: number;
  length: number;
}

export interface FrameHeader {
  keyframe: boolean;
  epoch: number;
  seq: number;
  width: number;
  height: number;
  cursor: { x: number; y: number } | null;
  rects: FrameRect[];
}

/**
 * Reads and checks a frame: the server drops anything that does not pass, so a broken or hostile
 * source cannot make thirty pages draw outside their canvas or read past the message.
 */
export function parseFrame(bytes: Uint8Array): FrameHeader | null {
  if (bytes.length < FRAME_HEADER_BYTES || bytes.length > MAX_FRAME_BYTES) return null;
  if (!FRAME_MAGIC.every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(4) !== FRAME_VERSION) return null;
  const flags = view.getUint8(5);
  const width = view.getUint16(14, true);
  const height = view.getUint16(16, true);
  if (width < 1 || height < 1 || width > MAX_FRAME_WIDTH || height > MAX_FRAME_HEIGHT) return null;
  const cx = view.getInt16(18, true);
  const cy = view.getInt16(20, true);
  const count = view.getUint16(22, true);
  if (count > MAX_FRAME_RECTS) return null;
  const rects: FrameRect[] = [];
  let at = FRAME_HEADER_BYTES;
  for (let i = 0; i < count; i += 1) {
    if (at + FRAME_RECT_HEADER_BYTES > bytes.length) return null;
    const x = view.getUint16(at, true);
    const y = view.getUint16(at + 2, true);
    const w = view.getUint16(at + 4, true);
    const h = view.getUint16(at + 6, true);
    const length = view.getUint32(at + 8, true);
    at += FRAME_RECT_HEADER_BYTES;
    if (w < 1 || h < 1 || x + w > width || y + h > height) return null;
    if (length < 1 || at + length > bytes.length) return null;
    rects.push({ x, y, w, h, offset: at, length });
    at += length;
  }
  if (at !== bytes.length) return null;
  return {
    keyframe: (flags & 1) === 1,
    epoch: view.getUint32(6, true),
    seq: view.getUint32(10, true),
    width,
    height,
    cursor: cx >= 0 && cy >= 0 && cx < width && cy < height ? { x: cx, y: cy } : null,
    rects,
  };
}

/** Writes a frame; the classroom app does this in C#, tests and the load script do it here. */
export function encodeFrame(frame: {
  keyframe: boolean;
  epoch: number;
  seq: number;
  width: number;
  height: number;
  cursor: { x: number; y: number } | null;
  rects: { x: number; y: number; w: number; h: number; jpeg: Uint8Array }[];
}): Uint8Array {
  const size =
    FRAME_HEADER_BYTES +
    frame.rects.reduce((s, r) => s + FRAME_RECT_HEADER_BYTES + r.jpeg.length, 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set(FRAME_MAGIC, 0);
  view.setUint8(4, FRAME_VERSION);
  view.setUint8(5, frame.keyframe ? 1 : 0);
  view.setUint32(6, frame.epoch >>> 0, true);
  view.setUint32(10, frame.seq >>> 0, true);
  view.setUint16(14, frame.width, true);
  view.setUint16(16, frame.height, true);
  view.setInt16(18, frame.cursor ? frame.cursor.x : -1, true);
  view.setInt16(20, frame.cursor ? frame.cursor.y : -1, true);
  view.setUint16(22, frame.rects.length, true);
  let at = FRAME_HEADER_BYTES;
  for (const r of frame.rects) {
    view.setUint16(at, r.x, true);
    view.setUint16(at + 2, r.y, true);
    view.setUint16(at + 4, r.w, true);
    view.setUint16(at + 6, r.h, true);
    view.setUint32(at + 8, r.jpeg.length, true);
    at += FRAME_RECT_HEADER_BYTES;
    bytes.set(r.jpeg, at);
    at += r.jpeg.length;
  }
  return bytes;
}

/**
 * The reference frame both languages must write byte for byte (FrameCodecTests.cs, screen.test.ts):
 * a keyframe of a 1280×720 picture, epoch 7, frame 42, cursor at 100×200, two rectangles with
 * stand-in bytes.
 */
export const REFERENCE_FRAME_HEX =
  '534e46310101070000002a0000000005d0026400c8000200000000005000500003000000010203' +
  '500010004000280004000000aabbccdd';
