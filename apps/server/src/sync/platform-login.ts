import { TeacherSchema, type Teacher } from '@sinf/shared';
import type { PlatformLink } from '../config.js';

/**
 * Checking a teacher's password with the platform, from a school computer (S2.6, ADR-011).
 *
 * The school computer never receives password hashes (sync/snapshot.ts). So the first time a
 * teacher logs in here the password is checked where it belongs — on the platform — and only then
 * remembered locally, which is what makes every later lesson start possible with no internet.
 *
 * No connection, a wrong password and "too many attempts" all come back the same way: `null`. The
 * caller then answers as it always does, and the teacher sees one honest message instead of a hint
 * about which half failed.
 */
export async function verifyOnPlatform(
  link: PlatformLink,
  email: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Teacher | null> {
  try {
    const response = await fetchImpl(`${link.url}/api/auth/teacher`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = TeacherSchema.safeParse((body as { teacher?: unknown } | null)?.teacher);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
