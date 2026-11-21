import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Locale } from '@sinf/shared';
import { hashSecret } from '../auth/password.js';
import type { Config } from '../config.js';
import { schema, type Db } from '../db/index.js';
import { ApiHttpError } from '../errors.js';
import type { Letter } from './mailer.js';

/**
 * A forgotten password (PLAN.md 2.1; stage 5, A7; ADR-021): a one-time link for an hour, by mail or
 * from an administrator. Setting the new password raises the teacher's session version, so every
 * old login — a stolen laptop's too — ends.
 */

export const RESET_MINUTES = 60;

const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex');

/** A fresh link for this teacher; links made before it stop working. */
export function makeResetToken(
  db: Db,
  userId: string,
  createdBy: string | null,
  now = new Date(),
): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const at = now.toISOString();
  const expiresAt = new Date(now.getTime() + RESET_MINUTES * 60_000).toISOString();
  db.transaction((tx) => {
    tx.update(schema.passwordResets)
      .set({ usedAt: at })
      .where(and(eq(schema.passwordResets.userId, userId), isNull(schema.passwordResets.usedAt)))
      .run();
    tx.insert(schema.passwordResets)
      .values({
        id: randomUUID(),
        userId,
        tokenHash: hashOf(token),
        createdBy,
        createdAt: at,
        expiresAt,
        usedAt: null,
      })
      .run();
  });
  return { token, expiresAt };
}

/** The site's address for a link: the configured one, or the one this request came to. */
export function siteUrl(config: Config, request: FastifyRequest): string {
  return config.publicUrl ?? `${request.protocol}://${request.host}`;
}

export const resetUrl = (base: string, token: string): string => `${base}/teacher/reset/${token}`;

/** Sets the new password by a link that still works; the link is spent, old logins end. */
export async function resetPassword(
  db: Db,
  token: string,
  password: string,
  now = new Date(),
): Promise<{ userId: string }> {
  const at = now.toISOString();
  const row = db
    .select()
    .from(schema.passwordResets)
    .where(
      and(
        eq(schema.passwordResets.tokenHash, hashOf(token)),
        isNull(schema.passwordResets.usedAt),
        gt(schema.passwordResets.expiresAt, at),
      ),
    )
    .get();
  if (!row) throw new ApiHttpError(400, 'reset_gone', 'This link no longer works');
  const passwordHash = await hashSecret(password);
  db.transaction((tx) => {
    tx.update(schema.passwordResets)
      .set({ usedAt: at })
      .where(eq(schema.passwordResets.id, row.id))
      .run();
    tx.update(schema.users)
      .set({ passwordHash, sessionVersion: sql`${schema.users.sessionVersion} + 1` })
      .where(eq(schema.users.id, row.userId))
      .run();
  });
  return { userId: row.userId };
}

/** The letter, in the teacher's language. */
export function resetLetter(to: string, name: string, url: string, locale: Locale): Letter {
  return locale === 'uz'
    ? {
        to,
        subject: 'Sinf: yangi parol',
        text: `Assalomu alaykum, ${name}!\n\nSinf platformasida yangi parol o‘rnatish uchun havola (1 soat amal qiladi):\n${url}\n\nAgar siz so‘ramagan bo‘lsangiz, bu xatni e’tiborsiz qoldiring — eski parol ishlayveradi.`,
      }
    : {
        to,
        subject: 'Sinf: новый пароль',
        text: `Здравствуйте, ${name}!\n\nСсылка, чтобы задать новый пароль на платформе Sinf (действует 1 час):\n${url}\n\nЕсли вы не просили — просто не обращайте внимания на письмо: старый пароль работает.`,
      };
}
