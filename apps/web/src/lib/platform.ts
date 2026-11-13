/**
 * Adapter between the web code and the desktop host (CLAUDE.md §5.5). The desktop app injects
 * `window.sinfHost` before the page runs; in the browser it is absent and every desktop-only capability
 * stays off. Web code reads this module, never `window.sinfHost` directly.
 */

export interface Platform {
  readonly isDesktop: boolean;
  readonly role: 'teacher' | 'student' | null;
  /** Desktop app version, e.g. `0.1.0.0`. */
  readonly version: string | null;
  /** Address student devices type to join (desktop only, when the computer is on a network). */
  readonly lanUrl: string | null;
}

interface SinfHost {
  isDesktop?: unknown;
  role?: unknown;
  version?: unknown;
  lanUrl?: unknown;
}

function read(): Platform {
  const host: SinfHost | undefined =
    typeof window === 'undefined'
      ? undefined
      : (window as unknown as { sinfHost?: SinfHost }).sinfHost;
  if (!host || host.isDesktop !== true) {
    return { isDesktop: false, role: null, version: null, lanUrl: null };
  }
  return {
    isDesktop: true,
    role: host.role === 'teacher' || host.role === 'student' ? host.role : null,
    version: typeof host.version === 'string' ? host.version : null,
    lanUrl: typeof host.lanUrl === 'string' && host.lanUrl.startsWith('http') ? host.lanUrl : null,
  };
}

export const platform: Platform = read();
