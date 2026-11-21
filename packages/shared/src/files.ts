import { z } from 'zod';

/**
 * "Мои работы" — a child's own folder (CLAUDE.md §4.9; stage 3, H12; ADR-015). The files live on the
 * lesson server — the teacher's computer in the classroom, the platform at home — never on a student
 * computer. These rules are shared so the page can refuse a file before sending it, and the server
 * refuses it again.
 */

/**
 * The platform's ceilings (CLAUDE.md §3.1: quota 200 MB, a file at most 50 MB); a school may lower
 * both in its rules (stage 5, A2).
 */
export const FILE_QUOTA_BYTES = 200 * 1024 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FILE_NAME_LENGTH = 120;

/**
 * What a child may keep: documents, tables, presentations, pictures, text and the code of the
 * lessons. An allow-list, not a block-list: anything Windows might run on a double click (.exe,
 * .js, .hta, .scr, .docm and their kin) is simply not on it.
 */
export const ALLOWED_EXTENSIONS = [
  'docx',
  'doc',
  'odt',
  'rtf',
  'txt',
  'pdf',
  'xlsx',
  'xls',
  'ods',
  'csv',
  'pptx',
  'ppt',
  'odp',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'html',
  'htm',
  'css',
  'py',
  'sb3',
  'ino',
] as const;
export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

/** Pictures the browser may show inline; everything else is only ever downloaded. */
export const PREVIEWABLE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

/** Names Windows keeps for devices: "con.txt" cannot be saved on any school computer. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export type FileNameProblem = 'empty' | 'extension' | 'reserved' | 'long';

/**
 * A file name as it will be stored, or why it cannot be: Unicode NFC (a Mac sends "й" in two
 * pieces), no characters Windows forbids, no trailing dots or spaces, no device names, a sane length
 * and an allowed extension. The name never becomes a path on disk — files are kept by their hash —
 * but it does become one on a student computer and in the class ZIP.
 */
export function normalizeFileName(
  raw: string,
): { ok: true; name: string } | { ok: false; problem: FileNameProblem } {
  const name = raw
    .normalize('NFC')
    .replace(FORBIDDEN, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (!name || name.startsWith('.')) return { ok: false, problem: 'empty' };
  if (name.length > MAX_FILE_NAME_LENGTH) return { ok: false, problem: 'long' };
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  if (RESERVED.test(stem.split('.')[0] ?? '')) return { ok: false, problem: 'reserved' };
  const ext = extensionOf(name);
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, problem: 'extension' };
  }
  return { ok: true, name };
}

/** Two names are the same file when they differ only in letter case — as on Windows. */
export function fileNameKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/**
 * The name a conflicting version is kept under (ADR-002 §5.3): "Рисунок (копия ПК-05).png". When
 * that name is taken too, a number follows: "Рисунок (копия ПК-05 2).png".
 */
export function conflictName(name: string, origin: string, n = 1): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const label = n > 1 ? `${origin} ${n}` : origin;
  const suffix = ` (копия ${label})`;
  return `${stem.slice(0, MAX_FILE_NAME_LENGTH - suffix.length - ext.length)}${suffix}${ext}`;
}

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const StudentFileSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256,
  updatedAt: z.string().min(1),
  /** Where the last version came from: "ПК-05", "браузер", "облако". */
  origin: z.string().min(1),
});
export type StudentFile = z.infer<typeof StudentFileSchema>;

export const StudentFilesResponseSchema = z.strictObject({
  student: z.strictObject({ id: z.string().min(1), name: z.string().min(1) }),
  files: z.array(StudentFileSchema),
  usedBytes: z.number().int().nonnegative(),
  quotaBytes: z.number().int().positive(),
  /** The largest file this child may keep, by the rules of the school (A2). */
  maxFileBytes: z.number().int().positive().default(MAX_FILE_BYTES),
});
export type StudentFilesResponse = z.infer<typeof StudentFilesResponseSchema>;

export const FileUploadResponseSchema = z.strictObject({
  file: StudentFileSchema,
  /**
   * The upload was based on a version that is no longer the latest, so it was kept beside it
   * under another name; null when it simply replaced or created the file.
   */
  conflictWith: z.string().nullable(),
  /** Nothing changed: the same content was already there. */
  unchanged: z.boolean(),
});
export type FileUploadResponse = z.infer<typeof FileUploadResponseSchema>;

// ---------- a child at home: class code → name → personal code (author's choice, H12)

/** Printed on the cards; six digits, so a child types it on a phone without hunting for letters. */
export const ClassCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/);

export const HomeLookupResponseSchema = z.strictObject({
  class: z.strictObject({ id: z.string().min(1), name: z.string().min(1) }),
  students: z.array(
    z.strictObject({
      id: z.string().min(1),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
    }),
  ),
});
export type HomeLookupResponse = z.infer<typeof HomeLookupResponseSchema>;

export const HomeLoginSchema = z.strictObject({
  classCode: ClassCodeSchema,
  studentId: z.string().min(1),
  code: z.array(z.string().min(1)).min(1).max(6),
});
export type HomeLogin = z.infer<typeof HomeLoginSchema>;

export const HomeMeResponseSchema = z.strictObject({
  student: z.strictObject({
    id: z.string().min(1),
    name: z.string().min(1),
    className: z.string().min(1),
  }),
});
export type HomeMeResponse = z.infer<typeof HomeMeResponseSchema>;

// ---------- school computer ↔ platform (H12)

/** One file as the platform holds it, for a school computer comparing its own copy. */
export const SyncedFileSchema = z.strictObject({
  name: z.string().min(1),
  sha256: sha256.nullable(),
  size: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
  deleted: z.boolean(),
});
export type SyncedFile = z.infer<typeof SyncedFileSchema>;

export const SyncedFilesResponseSchema = z.strictObject({
  studentId: z.string().min(1),
  files: z.array(SyncedFileSchema),
});
export type SyncedFilesResponse = z.infer<typeof SyncedFilesResponseSchema>;
