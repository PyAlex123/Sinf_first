/**
 * Shared contracts between server and web: locales, lesson content format, API schemas.
 * Realtime protocol schemas are added in step S1.7.
 */

/** Version of the realtime protocol; every message carries it in the `v` field (CLAUDE.md §5.6). */
export const PROTOCOL_VERSION = 1;

export * from './locale.js';
export * from './lesson.js';
export * from './api.js';
