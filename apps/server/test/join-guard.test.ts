import { describe, expect, it } from 'vitest';
import { JoinGuard } from '../src/services/join-guard.js';

describe('JoinGuard', () => {
  it('locks after five wrong codes for two minutes and then forgets', () => {
    const guard = new JoinGuard(5, 120_000);
    const key = 's1:student-01';
    expect(guard.status(key, 0)).toEqual({ locked: false, retryAfterSec: 0, attemptsLeft: 5 });
    for (let i = 1; i <= 4; i++) {
      expect(guard.fail(key, 1000 * i)).toMatchObject({ locked: false, attemptsLeft: 5 - i });
    }
    const locked = guard.fail(key, 5000);
    expect(locked).toEqual({ locked: true, retryAfterSec: 120, attemptsLeft: 0 });
    expect(guard.status(key, 65_000)).toEqual({ locked: true, retryAfterSec: 60, attemptsLeft: 0 });
    expect(guard.status(key, 125_001)).toEqual({
      locked: false,
      retryAfterSec: 0,
      attemptsLeft: 5,
    });
  });

  it('resets on success and keeps keys apart', () => {
    const guard = new JoinGuard(3, 1000);
    guard.fail('a', 0);
    guard.fail('a', 0);
    expect(guard.status('b', 0).attemptsLeft).toBe(3);
    guard.reset('a');
    expect(guard.status('a', 0).attemptsLeft).toBe(3);
  });
});
