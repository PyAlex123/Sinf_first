/**
 * Brute-force guard: after N failed attempts the key is locked for a while. In memory, per server process.
 * Used for student codes (`${sessionId}:${studentId}`, CLAUDE.md §4.1) and for teacher logins
 * (`${email}`, ADR-009).
 */
export interface GuardStatus {
  locked: boolean;
  /** Seconds until the lock ends (0 when not locked). */
  retryAfterSec: number;
  attemptsLeft: number;
}

interface Entry {
  failures: number;
  lockedUntil: number;
}

export class AttemptGuard {
  private readonly entries = new Map<string, Entry>();

  constructor(
    readonly maxAttempts = 5,
    readonly lockMs = 2 * 60 * 1000,
  ) {}

  status(key: string, now: number): GuardStatus {
    const entry = this.entries.get(key);
    if (!entry) return { locked: false, retryAfterSec: 0, attemptsLeft: this.maxAttempts };
    if (entry.lockedUntil > now) {
      return {
        locked: true,
        retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000),
        attemptsLeft: 0,
      };
    }
    if (entry.lockedUntil !== 0) {
      // lock expired: start over
      this.entries.delete(key);
      return { locked: false, retryAfterSec: 0, attemptsLeft: this.maxAttempts };
    }
    return { locked: false, retryAfterSec: 0, attemptsLeft: this.maxAttempts - entry.failures };
  }

  /** Records a wrong code; locks after the last allowed attempt. */
  fail(key: string, now: number): GuardStatus {
    const entry = this.entries.get(key) ?? { failures: 0, lockedUntil: 0 };
    entry.failures += 1;
    if (entry.failures >= this.maxAttempts) {
      entry.lockedUntil = now + this.lockMs;
    }
    this.entries.set(key, entry);
    return this.status(key, now);
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}
