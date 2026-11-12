import { describe, expect, it } from 'vitest';
import { summarize } from '../src/index.js';

describe('summarize', () => {
  it('sums points of passed criteria only', () => {
    const result = summarize(
      [
        { criterionId: 'heading', passed: true, points: 2 },
        { criterionId: 'font', passed: false, points: 1 },
      ],
      3,
    );
    expect(result.score).toBe(2);
    expect(result.maxScore).toBe(3);
  });
});
