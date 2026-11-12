/**
 * Practice file checkers (ADR-003). The same code runs in the browser, in the desktop WebView2 and on the server.
 * Stage 1 only declares the contract; real checkers arrive with step D3 / PLAN.md 3.6.
 */

/** Result of checking one criterion against a saved file. */
export interface CriterionResult {
  readonly criterionId: string;
  readonly passed: boolean;
  readonly points: number;
}

/** Aggregated result of checking one file. */
export interface CheckResult {
  readonly results: readonly CriterionResult[];
  readonly score: number;
  readonly maxScore: number;
}

export function summarize(results: readonly CriterionResult[], maxScore: number): CheckResult {
  const score = results.reduce((sum, r) => sum + (r.passed ? r.points : 0), 0);
  return { results, score, maxScore };
}
