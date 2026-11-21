import {
  ApiErrorSchema,
  FileUploadResponseSchema,
  HomeLookupResponseSchema,
  HomeMeResponseSchema,
  MAX_FILE_BYTES,
  normalizeFileName,
  StudentFilesResponseSchema,
  type FileUploadResponse,
  type HomeLookupResponse,
  type HomeMeResponse,
  type StudentFile,
  type StudentFilesResponse,
} from '@sinf/shared';
import type { ZodType } from 'zod';
import { ApiError } from './api.js';

/**
 * "Мои работы" from the page (H12). Whose folder is decided by how the page got in:
 * - `lesson` — a child in a running lesson, by their lesson token;
 * - `home` — a child at home, by the cookie of the home login;
 * - `teacher` — a teacher looking into a child's folder.
 * Files come down through `fetch` and a blob, not a link: a lesson token travels in headers, never
 * in an address a browser would keep in its history.
 */
export type FilesAccess =
  | { kind: 'lesson'; sessionId: string; token: string }
  | { kind: 'home' }
  | { kind: 'teacher'; studentId: string };

function headers(access: FilesAccess): Record<string, string> {
  return access.kind === 'lesson'
    ? { 'x-session-id': access.sessionId, 'x-participant-token': access.token }
    : {};
}

function base(access: FilesAccess): string {
  return access.kind === 'teacher'
    ? `/api/students/${encodeURIComponent(access.studentId)}/files`
    : '/api/my/files';
}

async function call<T>(res: Response, schema: ZodType<T>): Promise<T> {
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(json);
    throw parsed.success
      ? new ApiError(res.status, parsed.data.error, parsed.data.message, parsed.data.details)
      : new ApiError(res.status, 'http', `HTTP ${res.status}`);
  }
  return schema.parse(json);
}

export async function listFiles(access: FilesAccess): Promise<StudentFilesResponse> {
  const res = await fetch(base(access), { headers: headers(access), credentials: 'same-origin' });
  return call(res, StudentFilesResponseSchema);
}

/**
 * Why a file cannot even be sent: the page says it at once, the server says it again. `maxBytes`
 * is the school's limit from the folder's answer (A2); the platform's ceiling without one.
 */
export function uploadProblem(
  file: File,
  maxBytes: number = MAX_FILE_BYTES,
): { key: string; params?: Record<string, number> } | null {
  const named = normalizeFileName(file.name);
  if (!named.ok) return { key: `files.bad.${named.problem}` };
  if (file.size > maxBytes) {
    return { key: 'files.bad.size', params: { max: Math.floor(maxBytes / 1024 / 1024) } };
  }
  return null;
}

/** The i18n key that says why the server refused an upload. */
export function uploadFailureKey(e: unknown): string {
  if (!(e instanceof ApiError)) return 'common.error';
  if (e.code === 'quota') return 'files.bad.quota';
  if (e.code.startsWith('bad_name_')) return `files.bad.${e.code.slice('bad_name_'.length)}`;
  if (e.code === 'too_large') return 'files.bad.tooLarge';
  return 'common.error';
}

/**
 * Saves a file; `baseSha` is the version it replaces, when the child replaces one on purpose, and
 * `name` the name it is kept under (the practice's file, whatever the browser called the download).
 */
export async function uploadFile(
  access: FilesAccess,
  file: File,
  baseSha?: string,
  name: string = file.name,
): Promise<FileUploadResponse> {
  const q = new URLSearchParams({ name, ...(baseSha ? { base: baseSha } : {}) });
  const res = await fetch(`/api/my/files?${q.toString()}`, {
    method: 'PUT',
    headers: { ...headers(access), 'content-type': 'application/octet-stream' },
    credentials: 'same-origin',
    body: file,
  });
  return call(res, FileUploadResponseSchema);
}

export async function deleteFile(
  access: FilesAccess,
  file: StudentFile,
): Promise<StudentFilesResponse> {
  const res = await fetch(`/api/my/files/${encodeURIComponent(file.id)}`, {
    method: 'DELETE',
    headers: headers(access),
    credentials: 'same-origin',
  });
  return call(res, StudentFilesResponseSchema);
}

async function blobOf(access: FilesAccess, file: StudentFile, inline: boolean): Promise<Blob> {
  const res = await fetch(
    `${base(access)}/${encodeURIComponent(file.id)}/content${inline ? '?inline=1' : ''}`,
    { headers: headers(access), credentials: 'same-origin' },
  );
  if (!res.ok) throw new ApiError(res.status, 'http', `HTTP ${res.status}`);
  return res.blob();
}

/** Saves the file on this device, under its own name. */
export async function downloadFile(access: FilesAccess, file: StudentFile): Promise<void> {
  const url = URL.createObjectURL(await blobOf(access, file, false));
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** A picture to look at; the caller revokes the address when done with it. */
export async function previewUrl(access: FilesAccess, file: StudentFile): Promise<string> {
  return URL.createObjectURL(await blobOf(access, file, true));
}

// ---------- home login

async function post<T>(url: string, body: unknown, schema: ZodType<T>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  return call(res, schema);
}

export const home = {
  lookup: (classCode: string): Promise<HomeLookupResponse> =>
    post('/api/my/lookup', { classCode }, HomeLookupResponseSchema),
  login: (classCode: string, studentId: string, code: string[]): Promise<HomeMeResponse> =>
    post('/api/my/login', { classCode, studentId, code }, HomeMeResponseSchema),
  me: async (): Promise<HomeMeResponse> =>
    call(await fetch('/api/my/me', { credentials: 'same-origin' }), HomeMeResponseSchema),
  logout: async (): Promise<void> => {
    await fetch('/api/my/login', { method: 'DELETE', credentials: 'same-origin' });
  },
};

/** "1,4 МБ" — the way a school computer shows it. */
export function formatSize(bytes: number, locale: string): string {
  const units = locale === 'uz' ? ['B', 'KB', 'MB'] : ['Б', 'КБ', 'МБ'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toLocaleString(locale === 'uz' ? 'uz-UZ' : 'ru-RU', { maximumFractionDigits: digits })} ${units[unit]}`;
}
