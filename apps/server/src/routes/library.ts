import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import {
  authoredCounts,
  AuthoredLessonDocSchema,
  LibraryKindSchema,
  LibraryQuerySchema,
  ModerateSchema,
  ReportSchema,
  type LibraryItem,
  type LibraryReportsResponse,
  type LibraryResponse,
  type Teacher,
} from '@sinf/shared';
import { requireSuperadmin } from '../auth/access.js';
import { requireTeacher } from '../auth/teacher.js';
import { schema } from '../db/index.js';
import { notFound } from '../errors.js';

/**
 * The library (PLAN.md 3.9; stage 4, W8; ADR-019, addendum): what authors made public, found by
 * grade and words, copied by other teachers (`/authored-lessons/:id/copy`, `/programs/:id/copy`),
 * reported, and hidden by the superadmin when it has no place in a school.
 */

const MAX_RESULTS = 60;
const ItemParams = z.object({ kind: LibraryKindSchema, id: z.string().min(1) });

/** Lower case, ё as е: "Ёлка" finds "елка". SQLite's LIKE would not fold Cyrillic. */
const fold = (value: string): string => value.toLowerCase().replace(/ё/g, 'е');

export const libraryRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const { db } = app.ctx;

  const names = (): Map<string, string> =>
    new Map(
      db
        .select({ id: schema.users.id, name: schema.users.fullName })
        .from(schema.users)
        .all()
        .map((u) => [u.id, u.name]),
    );

  const copiesOf = (
    table: typeof schema.authoredLessons | typeof schema.programs,
  ): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const row of db
      .select({ sourceId: table.sourceId })
      .from(table)
      .where(and(isNotNull(table.sourceId), isNull(table.deletedAt)))
      .all()) {
      if (row.sourceId) counts.set(row.sourceId, (counts.get(row.sourceId) ?? 0) + 1);
    }
    return counts;
  };

  app.get('/library', { preHandler: requireTeacher }, (request): LibraryResponse => {
    const teacher = request.teacher as Teacher;
    const query = LibraryQuerySchema.parse(request.query);
    const words = fold(query.q ?? '')
      .split(/\s+/)
      .filter(Boolean);
    const matches = (text: string): boolean => words.every((w) => fold(text).includes(w));
    const owner = names();
    let items: LibraryItem[];
    if (query.kind === 'lesson') {
      const t = schema.authoredLessons;
      const copies = copiesOf(t);
      items = db
        .select()
        .from(t)
        .where(
          and(
            eq(t.visibility, 'public'),
            isNull(t.deletedAt),
            isNull(t.hiddenAt),
            ...(query.grade ? [eq(t.grade, query.grade)] : []),
          ),
        )
        .all()
        .filter((row) => matches(`${row.title} ${row.topic}`))
        .map((row) => ({
          kind: 'lesson' as const,
          id: row.id,
          title: row.title,
          topic: row.topic,
          grade: row.grade,
          ownerName: owner.get(row.ownerId) ?? '—',
          size: authoredCounts(AuthoredLessonDocSchema.parse(row.doc)).minutes,
          updatedAt: row.updatedAt,
          copies: copies.get(row.id) ?? 0,
          mine: row.ownerId === teacher.id,
        }));
    } else {
      const t = schema.programs;
      const copies = copiesOf(t);
      items = db
        .select()
        .from(t)
        .where(
          and(
            eq(t.visibility, 'public'),
            isNull(t.deletedAt),
            isNull(t.hiddenAt),
            ...(query.grade ? [eq(t.grade, query.grade)] : []),
          ),
        )
        .all()
        .filter((row) => matches(row.title))
        .map((row) => ({
          kind: 'program' as const,
          id: row.id,
          title: row.title,
          topic: '',
          grade: row.grade,
          ownerName: owner.get(row.ownerId) ?? '—',
          size: row.items.length,
          updatedAt: row.updatedAt,
          copies: copies.get(row.id) ?? 0,
          mine: row.ownerId === teacher.id,
        }));
    }
    // Most copied first, then the newest: what other teachers found worth taking.
    items.sort((a, b) => b.copies - a.copies || b.updatedAt.localeCompare(a.updatedAt));
    return { items: items.slice(0, MAX_RESULTS) };
  });

  const itemRow = (kind: 'lesson' | 'program', id: string) => {
    const t = kind === 'lesson' ? schema.authoredLessons : schema.programs;
    return db.select().from(t).where(eq(t.id, id)).get();
  };

  app.post('/library/report', { preHandler: requireTeacher }, (request): { ok: true } => {
    const teacher = request.teacher as Teacher;
    const body = ReportSchema.parse(request.body);
    const row = itemRow(body.kind, body.id);
    if (!row || row.visibility !== 'public' || row.deletedAt) throw notFound('Item');
    db.insert(schema.libraryReports)
      .values({
        id: randomUUID(),
        kind: body.kind,
        itemId: body.id,
        reporterId: teacher.id,
        reason: body.reason,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      })
      .run();
    request.log.info({ kind: body.kind, itemId: body.id }, 'library item reported');
    return { ok: true };
  });

  // ---------- the superadmin

  app.get(
    '/admin/library/reports',
    { preHandler: requireTeacher },
    (request): LibraryReportsResponse => {
      requireSuperadmin(db, request.teacher as Teacher);
      const owner = names();
      const reports = db
        .select()
        .from(schema.libraryReports)
        .where(isNull(schema.libraryReports.resolvedAt))
        .all()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return {
        reports: reports.map((r) => {
          const row = itemRow(r.kind, r.itemId);
          return {
            id: r.id,
            kind: r.kind,
            itemId: r.itemId,
            itemTitle: row?.title ?? '—',
            ownerName: row ? (owner.get(row.ownerId) ?? '—') : '—',
            reporterName: owner.get(r.reporterId) ?? '—',
            reason: r.reason,
            createdAt: r.createdAt,
            hidden: !!row?.hiddenAt,
          };
        }),
      };
    },
  );

  /** Hide an item from the library, or show it again; either way its reports are dealt with. */
  app.post(
    '/admin/library/:kind/:id/moderate',
    { preHandler: requireTeacher },
    (request): { ok: true } => {
      requireSuperadmin(db, request.teacher as Teacher);
      const { kind, id } = ItemParams.parse(request.params);
      const { hidden } = ModerateSchema.parse(request.body);
      if (!itemRow(kind, id)) throw notFound('Item');
      const at = new Date().toISOString();
      const t = kind === 'lesson' ? schema.authoredLessons : schema.programs;
      db.update(t)
        .set({ hiddenAt: hidden ? at : null })
        .where(eq(t.id, id))
        .run();
      db.update(schema.libraryReports)
        .set({ resolvedAt: at })
        .where(
          and(
            eq(schema.libraryReports.kind, kind),
            eq(schema.libraryReports.itemId, id),
            isNull(schema.libraryReports.resolvedAt),
          ),
        )
        .run();
      request.log.info({ kind, itemId: id, hidden }, 'library item moderated');
      return { ok: true };
    },
  );

  done();
};
