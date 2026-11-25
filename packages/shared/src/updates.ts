import { z } from 'zod';

/**
 * Updates of the Windows app (PLAN.md 6.11; stage 6, B6; ADR-023). CI builds an update installer,
 * signs it with the project's private key (ECDSA P-256) and describes it in `update.json`; the
 * platform hands it out, a teacher's computer keeps a copy for its classroom, and the updater on
 * every computer installs it only after checking the signature with the public key built into it.
 */

/** "0.3.112" — what CI gives the installer and Sinf.exe alike. */
export const UPDATE_VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:\.\d{1,6})?$/;
/** An update installer is the program without WebView2: tens of MB; this is a generous ceiling. */
export const MAX_UPDATE_BYTES = 600 * 1024 * 1024;

export const UpdateManifestSchema = z.strictObject({
  version: z.string().regex(UPDATE_VERSION),
  /** The installer's file name, as CI made it: "Sinf-update-0.3.112.exe". */
  file: z.string().regex(/^[A-Za-z0-9._-]{1,120}\.exe$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive().max(MAX_UPDATE_BYTES),
  /** ECDSA P-256 over `updateMessage`, r‖s (64 bytes) in base64. */
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
});
export type UpdateManifest = z.infer<typeof UpdateManifestSchema>;

/** What the signature covers: the version and the exact bytes, so neither can be swapped. */
export const updateMessage = (m: Pick<UpdateManifest, 'version' | 'sha256' | 'size'>): string =>
  `sinf-update:${m.version}:${m.sha256}:${m.size}`;

export const LatestUpdateResponseSchema = z.strictObject({
  update: UpdateManifestSchema.nullable(),
  /** A lesson is on in this classroom: the computers wait for it to end. */
  busy: z.boolean(),
});
export type LatestUpdateResponse = z.infer<typeof LatestUpdateResponseSchema>;

export const StoredUpdateSchema = UpdateManifestSchema.extend({ storedAt: z.string() });
export type StoredUpdate = z.infer<typeof StoredUpdateSchema>;

export const AdminUpdatesResponseSchema = z.strictObject({
  updates: z.array(StoredUpdateSchema),
  /** The platform checks signatures itself only when it knows the public key. */
  checksSignatures: z.boolean(),
});
export type AdminUpdatesResponse = z.infer<typeof AdminUpdatesResponseSchema>;

/** Numeric comparison of "0.3.112" and "0.3.99"; a missing part counts as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
