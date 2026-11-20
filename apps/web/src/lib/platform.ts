/**
 * Adapter between the web code and the desktop host (CLAUDE.md §5.5). The desktop app injects
 * `window.sinfHost` before the page runs; in the browser it is absent and every desktop-only capability
 * stays off. Web code reads this module, never `window.sinfHost` directly.
 *
 * Two hosts exist (ADR-014): the teacher's window, which runs the lesson server, and a student's
 * window, which opens the lesson on the teacher's computer.
 */

export interface Platform {
  readonly isDesktop: boolean;
  readonly role: 'teacher' | 'student' | null;
  /** Desktop app version, e.g. `0.1.0.0`. */
  readonly version: string | null;
  /** Address student devices type to join (teacher's window only, when on a network). */
  readonly lanUrl: string | null;
  /** What the school calls this student computer, e.g. `ПК-05` (student's window only). */
  readonly pcName: string | null;
}

interface SinfHost {
  isDesktop?: unknown;
  role?: unknown;
  version?: unknown;
  lanUrl?: unknown;
  pcName?: unknown;
}

const BROWSER: Platform = {
  isDesktop: false,
  role: null,
  version: null,
  lanUrl: null,
  pcName: null,
};

/** Reads what the host injected; anything malformed reads as "not there". */
export function readPlatform(host: unknown): Platform {
  if (!host || typeof host !== 'object') return BROWSER;
  const h = host as SinfHost;
  if (h.isDesktop !== true) return BROWSER;
  return {
    isDesktop: true,
    role: h.role === 'teacher' || h.role === 'student' ? h.role : null,
    version: typeof h.version === 'string' ? h.version : null,
    lanUrl: typeof h.lanUrl === 'string' && h.lanUrl.startsWith('http') ? h.lanUrl : null,
    pcName:
      typeof h.pcName === 'string' && h.pcName.trim().length > 0
        ? h.pcName.trim().slice(0, 20)
        : null,
  };
}

export const platform: Platform = readPlatform(
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as { sinfHost?: unknown }).sinfHost,
);
