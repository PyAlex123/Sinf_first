import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assetUrl,
  IMAGE_ASSET_EXTENSIONS,
  MAX_FILE_ASSET_BYTES,
  MAX_IMAGE_ASSET_BYTES,
  type AssetExtension,
  type AssetUploadResponse,
} from '@sinf/shared';
import { ApiHttpError } from '../errors.js';

/**
 * Files of teachers' lessons (stage 4, W1; ADR-019): slide pictures and practice templates. Kept once
 * per content under their SHA-256 in `DATA_DIR/assets/<sha>.<ext>` and served under
 * `/content/_assets/`, like the author's media: a name never changes meaning, so a school computer
 * fetches only what it lacks and a browser keeps them for a year.
 *
 * Nobody but the teacher who uploads is trusted about what a file is: the first bytes must be what
 * the extension says, and a text file must be text.
 */

export function assetsDir(dataDir: string): string {
  return join(dataDir, 'assets');
}

export function assetPath(dataDir: string, sha: string, ext: AssetExtension): string {
  return join(assetsDir(dataDir), `${sha}.${ext}`);
}

const startsWith = (bytes: Uint8Array, prefix: number[], at = 0): boolean =>
  prefix.every((b, i) => bytes[at + i] === b);

/** Does the content look like what its extension says? */
export function looksLike(bytes: Uint8Array, ext: AssetExtension): boolean {
  switch (ext) {
    case 'webp':
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
      );
    case 'png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'docx':
    case 'xlsx':
    case 'pptx':
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case 'txt':
    case 'html':
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return !bytes.includes(0);
      } catch {
        return false;
      }
  }
}

export function storeAsset(
  dataDir: string,
  bytes: Uint8Array,
  ext: AssetExtension,
): AssetUploadResponse {
  const image = IMAGE_ASSET_EXTENSIONS.includes(ext);
  const limit = image ? MAX_IMAGE_ASSET_BYTES : MAX_FILE_ASSET_BYTES;
  if (bytes.length === 0) throw new ApiHttpError(400, 'empty', 'The file is empty');
  if (bytes.length > limit) {
    throw new ApiHttpError(413, 'too_large', `At most ${Math.round(limit / 1024)} KB`);
  }
  if (!looksLike(bytes, ext)) {
    throw new ApiHttpError(400, 'not_that_kind', `This is not a .${ext} file`);
  }
  const sha = createHash('sha256').update(bytes).digest('hex');
  const path = assetPath(dataDir, sha, ext);
  if (!existsSync(path)) {
    mkdirSync(assetsDir(dataDir), { recursive: true });
    // Written beside and renamed: a reader never sees half a picture.
    const tmp = `${path}.${randomUUID()}.part`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, path);
  }
  return { sha, ext, size: bytes.length, url: assetUrl(sha, ext) };
}

export const ASSET_MIME: Record<AssetExtension, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain; charset=utf-8',
  html: 'text/plain; charset=utf-8',
};
