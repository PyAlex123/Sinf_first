import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@sinf/shared';
import { describeServer } from '../src/info.js';

describe('server skeleton', () => {
  it('resolves the shared workspace package', () => {
    expect(describeServer()).toContain(`protocol v${PROTOCOL_VERSION}`);
  });
});
