import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import {
  INVITE_DAYS,
  type CreatedInviteResponse,
  type InviteAcceptResponse,
  type InviteInfoResponse,
  type SchoolInvite,
  type SchoolInvitesResponse,
  type Teacher,
} from '@sinf/shared';
import { requireSchoolAdmin } from '../auth/access.js';
import { readTeacher, requireTeacher } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { ApiHttpError } from '../errors.js';

/**
 * Inviting teachers by a link (PLAN.md 2.3; stage 5, A6; ADR-021): the administrator makes a link
 * for a week and sends it to the staff's chat; a teacher who opens it signs in or registers and is
 * a teacher of the school at once, with no request to approve. Only on the website.
 */

type InviteRow = typeof schema.schoolInvites.$inferSelect;

/** The secret has 256 bits of chance: a plain hash is enough to find it and to keep it unknown. */
const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex');

const SchoolParams = z.object({ id: z.string().min(1) });
const InviteParams = z.object({ id: z.string().min(1), inviteId: z.string().min(1) });
const TokenParams = z.object({ token: z.string().min(20).max(100) });

export const inviteRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const { db } = app.ctx;
  const platformOnly = (): void => {
    if (app.sync?.link() != null) {
      throw new ApiHttpError(409, 'edit_on_platform', 'Invitations live on the website');
    }
  };

  const view = (row: InviteRow): SchoolInvite => ({
    id: row.id,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    createdByName:
      db
        .select({ name: schema.users.fullName })
        .from(schema.users)
        .where(eq(schema.users.id, row.createdBy))
        .get()?.name ?? '—',
    used: row.used,
  });

  const liveOf = (schoolId: string): SchoolInvite[] =>
    db
      .select()
      .from(schema.schoolInvites)
      .where(
        and(
          eq(schema.schoolInvites.schoolId, schoolId),
          isNull(schema.schoolInvites.revokedAt),
          gt(schema.schoolInvites.expiresAt, new Date().toISOString()),
        ),
      )
      .orderBy(desc(schema.schoolInvites.createdAt))
      .all()
      .map(view);

  /** A link that still opens the door, or 404 `invite_gone`. */
  const openInvite = (token: string): InviteRow => {
    const row = db
      .select()
      .from(schema.schoolInvites)
      .where(eq(schema.schoolInvites.tokenHash, hashOf(token)))
      .get();
    if (!row || row.revokedAt || row.expiresAt <= new Date().toISOString()) {
      throw new ApiHttpError(404, 'invite_gone', 'This link no longer works');
    }
    return row;
  };

  // ---------- the administrator

  app.get(
    '/schools/:id/invites',
    { preHandler: requireTeacher },
    (request): SchoolInvitesResponse => {
      const { id } = SchoolParams.parse(request.params);
      requireSchoolAdmin(db, request.teacher as Teacher, id);
      return { invites: liveOf(id) };
    },
  );

  app.post(
    '/schools/:id/invites',
    { preHandler: requireTeacher },
    (request): CreatedInviteResponse => {
      const { id } = SchoolParams.parse(request.params);
      const teacher = request.teacher as Teacher;
      requireSchoolAdmin(db, teacher, id);
      platformOnly();
      const token = randomBytes(32).toString('base64url');
      const now = new Date();
      const row: InviteRow = {
        id: randomUUID(),
        schoolId: id,
        tokenHash: hashOf(token),
        createdBy: teacher.id,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString(),
        revokedAt: null,
        used: 0,
      };
      db.insert(schema.schoolInvites).values(row).run();
      request.log.info({ schoolId: id, inviteId: row.id }, 'school invite made');
      return { invite: view(row), token };
    },
  );

  app.delete(
    '/schools/:id/invites/:inviteId',
    { preHandler: requireTeacher },
    (request): SchoolInvitesResponse => {
      const { id, inviteId } = InviteParams.parse(request.params);
      requireSchoolAdmin(db, request.teacher as Teacher, id);
      db.update(schema.schoolInvites)
        .set({ revokedAt: new Date().toISOString() })
        .where(and(eq(schema.schoolInvites.id, inviteId), eq(schema.schoolInvites.schoolId, id)))
        .run();
      return { invites: liveOf(id) };
    },
  );

  // ---------- whoever opens the link

  app.get('/invites/:token', (request): InviteInfoResponse => {
    platformOnly();
    const { token } = TokenParams.parse(request.params);
    const invite = openInvite(token);
    const school = db
      .select()
      .from(schema.schools)
      .where(eq(schema.schools.id, invite.schoolId))
      .get();
    if (!school) throw new ApiHttpError(404, 'invite_gone', 'This link no longer works');
    // Signed in or not is no error here: the page says "sign in" or "join" by this answer.
    const teacher = readTeacher(request, db);
    const member =
      teacher &&
      db
        .select()
        .from(schema.schoolMembers)
        .where(
          and(
            eq(schema.schoolMembers.schoolId, school.id),
            eq(schema.schoolMembers.userId, teacher.id),
          ),
        )
        .get();
    return {
      school: { id: school.id, name: school.name, city: school.city },
      expiresAt: invite.expiresAt,
      visitor: !teacher ? 'guest' : member ? 'member' : 'teacher',
    };
  });

  app.post(
    '/invites/:token/accept',
    { preHandler: requireTeacher },
    (request): InviteAcceptResponse => {
      platformOnly();
      const { token } = TokenParams.parse(request.params);
      const teacher = request.teacher as Teacher;
      const invite = openInvite(token);
      const member = db
        .select()
        .from(schema.schoolMembers)
        .where(
          and(
            eq(schema.schoolMembers.schoolId, invite.schoolId),
            eq(schema.schoolMembers.userId, teacher.id),
          ),
        )
        .get();
      if (member) return { schoolId: invite.schoolId, already: true };
      const at = new Date().toISOString();
      db.transaction((tx) => {
        tx.insert(schema.schoolMembers)
          .values({ schoolId: invite.schoolId, userId: teacher.id, role: 'teacher', createdAt: at })
          .run();
        // A request they made before is answered by the link.
        tx.update(schema.schoolJoinRequests)
          .set({ status: 'approved', decidedAt: at, decidedBy: invite.createdBy })
          .where(
            and(
              eq(schema.schoolJoinRequests.schoolId, invite.schoolId),
              eq(schema.schoolJoinRequests.userId, teacher.id),
              eq(schema.schoolJoinRequests.status, 'pending'),
            ),
          )
          .run();
        tx.update(schema.schoolInvites)
          .set({ used: sql`${schema.schoolInvites.used} + 1` })
          .where(eq(schema.schoolInvites.id, invite.id))
          .run();
      });
      request.log.info({ schoolId: invite.schoolId, userId: teacher.id }, 'teacher joined by link');
      return { schoolId: invite.schoolId, already: false };
    },
  );

  done();
};
