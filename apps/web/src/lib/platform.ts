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

// ---------- messages between the page and the classroom app (stage 3)

/** What the page asks the classroom app to do. */
export type HostCommand =
  /** "Attention!": keyboard and mouse of this computer stop working until unlocked (H4). */
  | { type: 'lock'; on: boolean }
  /** A teacher's panel is open: send a thumbnail every 3 s when the screen changed (H5). */
  | { type: 'thumbs'; on: boolean }
  /** Photograph the screen now and hand the picture back (H5). */
  | { type: 'screenshot'; reason: 'manual' | 'before_end' | 'stage_end' }
  /** Open a program of the practice, or bring it back to the front (H6). Only Paint for now. */
  | { type: 'launch'; app: 'paint' }
  /** The practice is over: close its programs, asking to save first (H6). */
  | { type: 'closeApps' };

/** What the classroom app tells the page. */
export type HostEvent =
  /** A screen thumbnail: base64 JPEG, 320 px (H5). */
  | { type: 'thumb'; jpeg: string }
  /** The practice program opened or closed (H6). */
  | { type: 'app'; running: boolean }
  /** "Помогите" pressed on the panel over the program (H6). */
  | { type: 'hand' }
  /** A screenshot asked for: base64 JPEG up to 1920 px (H5). */
  | {
      type: 'screenshot';
      jpeg: string;
      width: number;
      height: number;
      reason: 'manual' | 'before_end' | 'stage_end';
    };

interface WebViewChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

function channel(): WebViewChannel | null {
  if (typeof window === 'undefined') return null;
  const chrome = (window as unknown as { chrome?: { webview?: WebViewChannel } }).chrome;
  return chrome?.webview ?? null;
}

/** Sends a command to the classroom app; in a browser there is nobody to hear it. */
export function hostSend(command: HostCommand): void {
  if (platform.role !== 'student') return;
  channel()?.postMessage(command);
}

/** Listens to the classroom app; returns the way to stop listening. */
export function onHostEvent(listener: (event: HostEvent) => void): () => void {
  const webview = platform.role === 'student' ? channel() : null;
  if (!webview) return () => undefined;
  const handler = (event: { data: unknown }): void => {
    const data = event.data;
    if (data && typeof data === 'object' && typeof (data as { type?: unknown }).type === 'string') {
      listener(data as HostEvent);
    }
  };
  webview.addEventListener('message', handler);
  return () => webview.removeEventListener('message', handler);
}

/**
 * Pages a classroom kiosk may show (stage 3, H3): the way into the lesson and the lesson itself.
 * The Windows app filters real navigations; this covers the app's own links, which never leave the
 * page and so never reach that filter. The same list lives in C# (`StudentNavigation`).
 */
export function allowedInKiosk(path: string): boolean {
  const clean = path.split('?')[0] ?? '';
  return clean === '/join' || clean === '/join/' || /^\/s\/[^/]+\/?$/.test(clean);
}

export const platform: Platform = readPlatform(
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as { sinfHost?: unknown }).sinfHost,
);
