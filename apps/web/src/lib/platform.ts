/**
 * Adapter between the web code and the desktop host (CLAUDE.md §5.5). In the browser every desktop-only
 * capability is absent; the desktop app will inject `window.sinfHost` and this module will wrap it.
 */
export interface Platform {
  readonly isDesktop: boolean;
  readonly role: 'teacher' | 'student' | null;
}

export const platform: Platform = {
  isDesktop: false,
  role: null,
};
