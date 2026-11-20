import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { courseUrl } from '@sinf/shared';

/** Image budget for lesson screenshots (STAGE1.md S1.2, CLAUDE.md §3.1). */
export const MAX_IMAGE_WIDTH = 1190;
export const MAX_IMAGE_BYTES = 150 * 1024;
const QUALITY_STEPS = [80, 72, 64, 56, 48, 40, 32] as const;

export interface MediaFile {
  /** File name inside `media/`: content hash + `.webp`. */
  name: string;
  bytes: Buffer;
  sourceBytes: number;
}

/** Decodes a `data:image/…;base64,…` URL. Returns `undefined` for anything else. */
export function decodeDataImage(url: string): Buffer | undefined {
  const match = /^data:image\/(?:jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i.exec(
    url.trim(),
  );
  return match?.[1] ? Buffer.from(match[1].replace(/\s+/g, ''), 'base64') : undefined;
}

/** Re-encodes an image to WebP within the width and size budget, lowering quality until it fits. */
export async function toWebp(source: Buffer): Promise<Buffer> {
  let last: Buffer | undefined;
  for (const quality of QUALITY_STEPS) {
    last = await sharp(source)
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer();
    if (last.length <= MAX_IMAGE_BYTES) {
      return last;
    }
  }
  if (!last) {
    throw new Error('No quality steps configured');
  }
  throw new Error(
    `Image does not fit ${MAX_IMAGE_BYTES} bytes even at the lowest quality (${last.length})`,
  );
}

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

/**
 * Collects the images of a course. The same source picture used in several places (children's slides and
 * teacher scenarios) is stored once. File names are content hashes, so the files can be cached forever.
 */
export class MediaStore {
  private readonly bySource = new Map<string, MediaFile>();
  private readonly used = new Map<string, MediaFile>();

  constructor(private readonly courseId: string) {}

  /** Encodes source images in advance (in parallel); later `url()` calls are synchronous. */
  async prepare(sources: Iterable<Buffer>): Promise<void> {
    const pending = new Map<string, Buffer>();
    for (const source of sources) {
      const key = sha256(source);
      if (!this.bySource.has(key)) {
        pending.set(key, source);
      }
    }
    await Promise.all(
      [...pending].map(async ([key, source]) => {
        const bytes = await toWebp(source);
        const name = `${sha256(bytes).slice(0, 16)}.webp`;
        this.bySource.set(key, { name, bytes, sourceBytes: source.length });
      }),
    );
  }

  /** URL of a prepared image; marks the file as used so it is written to `media/`. */
  url(source: Buffer): string {
    const file = this.bySource.get(sha256(source));
    if (!file) {
      throw new Error('Image was not prepared');
    }
    this.used.set(file.name, file);
    return courseUrl(this.courseId, `media/${file.name}`);
  }

  /** Files referenced by at least one lesson or scenario, sorted by name. */
  files(): MediaFile[] {
    return [...this.used.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
