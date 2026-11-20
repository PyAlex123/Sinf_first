import { randomBytes, scrypt as scryptCb, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Hashing of teacher passwords and student codes with scrypt from node:crypto (no native dependency).
 * Format: `scrypt$<N>$<salt base64>$<hash base64>`.
 */

const scrypt = (secret: string, salt: Buffer, keyLength: number, cost: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCb(secret, salt, keyLength, { N: cost }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
const COST = 16384;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export function hashSecretSync(secret: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const hash = scryptSync(secret, salt, KEY_LENGTH, { N: COST });
  return encode(COST, salt, hash);
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scrypt(secret, salt, KEY_LENGTH, COST);
  return encode(COST, salt, hash);
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parsed = decode(stored);
  if (!parsed) {
    return false;
  }
  const hash = await scrypt(secret, parsed.salt, parsed.hash.length, parsed.cost);
  return hash.length === parsed.hash.length && timingSafeEqual(hash, parsed.hash);
}

function encode(cost: number, salt: Buffer, hash: Buffer): string {
  return `scrypt$${cost}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function decode(stored: string): { cost: number; salt: Buffer; hash: Buffer } | undefined {
  const [algo, costText, saltText, hashText] = stored.split('$');
  if (algo !== 'scrypt' || !costText || !saltText || !hashText) {
    return undefined;
  }
  const cost = Number(costText);
  if (!Number.isInteger(cost) || cost < 2 || (cost & (cost - 1)) !== 0) {
    return undefined;
  }
  return { cost, salt: Buffer.from(saltText, 'base64'), hash: Buffer.from(hashText, 'base64') };
}
