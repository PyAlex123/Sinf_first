import type { CheckOutcome } from '@sinf/shared';

/** One criterion's answer, before it gets its id. */
export interface Verdict {
  outcome: CheckOutcome;
  found: string | null;
}

export const verdict = (ok: boolean, found: string | null): Verdict => ({
  outcome: ok ? 'pass' : 'fail',
  found,
});

/** The checker cannot tell: the teacher looks (a formula with no saved value, an odd file). */
export const unknown = (found: string): Verdict => ({ outcome: 'unknown', found });
