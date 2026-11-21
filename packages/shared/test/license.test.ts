import { describe, expect, it } from 'vitest';
import { licenseStatus } from '../src/index.js';

/** B2: where a license stands on a day. */

describe('a license', () => {
  const terms = { classesLimit: 5, validFrom: '2026-09-01', validTo: '2027-05-31' };
  it('is active between its days, then in grace for 14 days, then expired', () => {
    expect(licenseStatus(null, '2026-11-21')).toBe('none');
    expect(licenseStatus(terms, '2026-08-31')).toBe('future');
    expect(licenseStatus(terms, '2026-09-01')).toBe('active');
    expect(licenseStatus(terms, '2027-05-31')).toBe('active');
    expect(licenseStatus(terms, '2027-06-14')).toBe('grace');
    expect(licenseStatus(terms, '2027-06-15')).toBe('expired');
  });
});
