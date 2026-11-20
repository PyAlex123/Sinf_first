import { describe, expect, it } from 'vitest';
import { hashSecret, hashSecretSync, verifySecret } from '../src/auth/password.js';

describe('scrypt secrets', () => {
  it('verifies the right secret and rejects the wrong one', async () => {
    const stored = await hashSecret('sun+ball');
    expect(stored).toMatch(/^scrypt\$16384\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    await expect(verifySecret('sun+ball', stored)).resolves.toBe(true);
    await expect(verifySecret('ball+sun', stored)).resolves.toBe(false);
  });

  it('uses a random salt and accepts sync hashes', async () => {
    const a = hashSecretSync('demo1234');
    const b = hashSecretSync('demo1234');
    expect(a).not.toBe(b);
    await expect(verifySecret('demo1234', a)).resolves.toBe(true);
  });

  it('rejects malformed stored values', async () => {
    await expect(verifySecret('x', 'plain')).resolves.toBe(false);
    await expect(verifySecret('x', 'scrypt$1000$AAAA$AAAA')).resolves.toBe(false);
  });
});
