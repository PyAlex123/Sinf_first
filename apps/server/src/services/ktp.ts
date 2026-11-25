import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import {
  ktpPlanned,
  suggestLesson,
  type AddKtpRow,
  type CreateKtp,
  type KtpChanges,
  type KtpLessonRef,
  type KtpPlan,
  type KtpPlanSummary,
  type KtpRow,
  type Locale,
  type SessionKtpResponse,
  type UpdateKtpRow,
} from '@sinf/shared';
import { colleaguesOf } from '../auth/access.js';
import { settingsForClass } from './school-settings.js';
import type { ContentStore } from '../content/index.js';
import { schema, type Db } from '../db/index.js';
import { ApiHttpError, notFound } from '../errors.js';
import { buildXlsx, type Cell } from './xlsx.js';

/**
 * The teacher's KTP (PLAN.md 5.2–5.3; stage 4, W10–W11; ADR-020): saved from the import wizard,
 * shown row by row with its lessons and what is done, changed by hand, and given back as an Excel
 * file in the same columns.
 */

type PlanRow = typeof schema.ktpPlans.$inferSelect;
type TopicRow = typeof schema.ktpRows.$inferSelect;

export function createKtp(db: Db, teacherId: string, input: CreateKtp, now = new Date()): string {
  const at = now.toISOString();
  const id = randomUUID();
  db.transaction((tx) => {
    tx.insert(schema.ktpPlans)
      .values({
        id,
        teacherId,
        classId: input.classId,
        title: input.title,
        sourceFile: input.sourceFile,
        createdAt: at,
        updatedAt: at,
      })
      .run();
    input.rows.forEach((row, position) => {
      tx.insert(schema.ktpRows)
        .values({
          id: randomUUID(),
          planId: id,
          position,
          ...row,
          originalTopic: row.topic,
          originalWeekOrDate: row.weekOrDate,
        })
        .run();
    });
  });
  return id;
}

/** The teacher's own plan, or 404: a KTP is nobody else's business. */
export function ownPlan(db: Db, teacherId: string, planId: string): PlanRow {
  const plan = db
    .select()
    .from(schema.ktpPlans)
    .where(and(eq(schema.ktpPlans.id, planId), eq(schema.ktpPlans.teacherId, teacherId)))
    .get();
  if (!plan) throw notFound('KTP');
  return plan;
}

function topicsOf(db: Db, planId: string): TopicRow[] {
  return db
    .select()
    .from(schema.ktpRows)
    .where(and(eq(schema.ktpRows.planId, planId), isNull(schema.ktpRows.deletedAt)))
    .orderBy(asc(schema.ktpRows.position))
    .all();
}

function className(db: Db, classId: string): string {
  return (
    db
      .select({ name: schema.classes.name })
      .from(schema.classes)
      .where(eq(schema.classes.id, classId))
      .get()?.name ?? '—'
  );
}

function summaryOf(db: Db, plan: PlanRow, topics: TopicRow[], today = new Date()): KtpPlanSummary {
  return {
    id: plan.id,
    classId: plan.classId,
    className: className(db, plan.classId),
    title: plan.title,
    sourceFile: plan.sourceFile,
    rows: topics.length,
    done: topics.filter((t) => t.isDone).length,
    planned: ktpPlanned(topics, today),
    updatedAt: plan.updatedAt,
  };
}

export function listKtp(db: Db, teacherId: string): KtpPlanSummary[] {
  return db
    .select()
    .from(schema.ktpPlans)
    .where(eq(schema.ktpPlans.teacherId, teacherId))
    .orderBy(desc(schema.ktpPlans.updatedAt))
    .all()
    .map((plan) => summaryOf(db, plan, topicsOf(db, plan.id)));
}

/** The share of KTP changes a school allows (CLAUDE.md §4.10), from its settings (A1). */
function allowedPercent(db: Db, classId: string): number {
  return settingsForClass(db, classId).ktpChangePercent;
}

/** Changed against the imported file: topic or date edited, removed, or added by hand. */
function changesOf(db: Db, plan: PlanRow): KtpChanges {
  const all = db.select().from(schema.ktpRows).where(eq(schema.ktpRows.planId, plan.id)).all();
  const base = all.filter((r) => r.originalTopic !== null).length;
  const changed = all.filter((r) =>
    r.originalTopic === null
      ? !r.deletedAt
      : r.deletedAt !== null ||
        r.topic !== r.originalTopic ||
        r.weekOrDate !== (r.originalWeekOrDate ?? ''),
  ).length;
  return { base, changed, allowedPercent: allowedPercent(db, plan.classId) };
}

/**
 * Lessons a topic can be taught with: the author's, the teacher's own and their school's shared
 * ones (ADR-019).
 */
export function lessonCatalog(db: Db, content: ContentStore, teacherId: string): KtpLessonRef[] {
  const authored = db
    .select({ id: schema.authoredLessons.id, title: schema.authoredLessons.title })
    .from(schema.authoredLessons)
    .where(
      and(
        isNull(schema.authoredLessons.deletedAt),
        or(
          eq(schema.authoredLessons.ownerId, teacherId),
          and(
            inArray(schema.authoredLessons.ownerId, colleaguesOf(db, teacherId)),
            ne(schema.authoredLessons.visibility, 'private'),
            isNull(schema.authoredLessons.hiddenAt),
          ),
        ),
      ),
    )
    .all();
  const author = content.courses.flatMap((c) =>
    c.lessons.map((l) => ({ id: l.id, title: l.title })),
  );
  return [...authored, ...author];
}

/** The last day the class had each lesson, for "held — mark it done?". */
function heldDays(db: Db, classId: string): Map<string, string> {
  const held = new Map<string, string>();
  const rows = db
    .select({ lessonId: schema.sessions.lessonId, startedAt: schema.sessions.startedAt })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.classId, classId), isNotNull(schema.sessions.endedAt)))
    .orderBy(asc(schema.sessions.startedAt))
    .all();
  for (const r of rows) held.set(r.lessonId, r.startedAt);
  return held;
}

export function ktpPlan(db: Db, content: ContentStore, plan: PlanRow, today = new Date()): KtpPlan {
  const topics = topicsOf(db, plan.id);
  const held = heldDays(db, plan.classId);
  const catalog = lessonCatalog(db, content, plan.teacherId);
  // A lesson already used for a topic is not offered for another.
  const used = new Set(topics.flatMap((t) => (t.lessonId ? [t.lessonId] : [])));
  const free = catalog.filter((l) => !used.has(l.id));
  return {
    ...summaryOf(db, plan, topics, today),
    items: topics.map((t): KtpRow => ({
      id: t.id,
      position: t.position,
      number: t.number,
      topic: t.topic,
      hours: t.hours,
      weekOrDate: t.weekOrDate,
      note: t.note,
      lessonId: t.lessonId,
      lessonTitle: t.lessonId ? (content.getLesson(t.lessonId)?.title ?? null) : null,
      isDone: t.isDone,
      doneAt: t.doneAt,
      heldAt: t.lessonId ? (held.get(t.lessonId) ?? null) : null,
      suggestion: t.lessonId || t.isDone ? null : suggestLesson(t.topic, free),
    })),
    changes: changesOf(db, plan),
  };
}

// ---------- changing a KTP by hand (W11)

function ownTopic(db: Db, planId: string, rowId: string): TopicRow {
  const row = db
    .select()
    .from(schema.ktpRows)
    .where(
      and(
        eq(schema.ktpRows.id, rowId),
        eq(schema.ktpRows.planId, planId),
        isNull(schema.ktpRows.deletedAt),
      ),
    )
    .get();
  if (!row) throw notFound('KTP row');
  return row;
}

function requireLesson(content: ContentStore, lessonId: string | null | undefined): void {
  if (lessonId && !content.getLesson(lessonId)) {
    throw new ApiHttpError(400, 'unknown_lesson', 'No such lesson');
  }
}

function touch(db: Db, planId: string, at: string): void {
  db.update(schema.ktpPlans).set({ updatedAt: at }).where(eq(schema.ktpPlans.id, planId)).run();
}

export function updateKtpRow(
  db: Db,
  content: ContentStore,
  planId: string,
  rowId: string,
  input: UpdateKtpRow,
  now = new Date(),
): void {
  const row = ownTopic(db, planId, rowId);
  requireLesson(content, input.lessonId);
  const at = now.toISOString();
  const doneAt = input.isDone === undefined ? row.doneAt : input.isDone ? (row.doneAt ?? at) : null;
  db.update(schema.ktpRows)
    .set({ ...input, doneAt })
    .where(eq(schema.ktpRows.id, rowId))
    .run();
  touch(db, planId, at);
}

export function linkKtpRows(
  db: Db,
  content: ContentStore,
  planId: string,
  links: readonly { rowId: string; lessonId: string }[],
  now = new Date(),
): void {
  for (const link of links) {
    ownTopic(db, planId, link.rowId);
    requireLesson(content, link.lessonId);
  }
  db.transaction((tx) => {
    for (const link of links) {
      tx.update(schema.ktpRows)
        .set({ lessonId: link.lessonId })
        .where(eq(schema.ktpRows.id, link.rowId))
        .run();
    }
  });
  touch(db, planId, now.toISOString());
}

/** A topic added by hand, after another one; the ones below move down. */
export function addKtpRow(db: Db, planId: string, input: AddKtpRow, now = new Date()): void {
  const after = input.afterId ? ownTopic(db, planId, input.afterId).position : -1;
  db.transaction((tx) => {
    const below = tx
      .select()
      .from(schema.ktpRows)
      .where(eq(schema.ktpRows.planId, planId))
      .all()
      .filter((r) => r.position > after);
    for (const r of below) {
      tx.update(schema.ktpRows)
        .set({ position: r.position + 1 })
        .where(eq(schema.ktpRows.id, r.id))
        .run();
    }
    tx.insert(schema.ktpRows)
      .values({ id: randomUUID(), planId, position: after + 1, ...input.row })
      .run();
  });
  touch(db, planId, now.toISOString());
}

/** A removed topic stays as a row: it counts among the changes of the KTP. */
export function deleteKtpRow(db: Db, planId: string, rowId: string, now = new Date()): void {
  const row = ownTopic(db, planId, rowId);
  const at = now.toISOString();
  if (row.originalTopic === null) {
    db.delete(schema.ktpRows).where(eq(schema.ktpRows.id, rowId)).run();
  } else {
    db.update(schema.ktpRows).set({ deletedAt: at }).where(eq(schema.ktpRows.id, rowId)).run();
  }
  touch(db, planId, at);
}

/**
 * After a lesson: the topic of the class's KTP to mark done — the one linked to this lesson, or the
 * first topic not done yet. Of several KTPs of the class, the one that has this lesson, else the
 * latest.
 */
export function sessionKtp(
  db: Db,
  content: ContentStore,
  teacherId: string,
  session: { classId: string; lessonId: string },
): SessionKtpResponse {
  const plans = db
    .select()
    .from(schema.ktpPlans)
    .where(
      and(eq(schema.ktpPlans.teacherId, teacherId), eq(schema.ktpPlans.classId, session.classId)),
    )
    .orderBy(desc(schema.ktpPlans.updatedAt))
    .all();
  if (plans.length === 0) return { ktp: null };
  const views = plans.map((p) => ktpPlan(db, content, p));
  const withLesson = views.find((v) => v.items.some((i) => i.lessonId === session.lessonId));
  const view = withLesson ?? views[0];
  if (!view) return { ktp: null };
  const linked = view.items.find((i) => i.lessonId === session.lessonId);
  const row = linked ?? view.items.find((i) => !i.isDone) ?? null;
  return { ktp: { planId: view.id, planTitle: view.title, row, linked: !!linked } };
}

export function deleteKtp(db: Db, teacherId: string, planId: string): void {
  ownPlan(db, teacherId, planId);
  db.transaction((tx) => {
    tx.delete(schema.ktpRows).where(eq(schema.ktpRows.planId, planId)).run();
    tx.delete(schema.ktpPlans).where(eq(schema.ktpPlans.id, planId)).run();
  });
}

// ---------- back to Excel

const LABELS: Record<Locale, string[]> = {
  ru: ['№', 'Тема урока', 'Часы', 'Неделя / дата', 'Примечание', 'Проведено'],
  uz: ['№', 'Dars mavzusi', 'Soat', 'Hafta / sana', 'Izoh', 'O‘tilgan'],
  en: ['No.', 'Lesson topic', 'Hours', 'Week / date', 'Note', 'Done'],
};
const DONE: Record<Locale, string> = { ru: 'да', uz: 'ha', en: 'yes' };

/** Rows of the sheet, apart from the file itself — easy to check in a test. */
export function ktpRows(plan: KtpPlan, locale: Locale): Cell[][] {
  return [
    [{ value: `${plan.title} — ${plan.className}`, style: 'bold' }],
    LABELS[locale].map((value) => ({ value, style: 'boldCenter' as const })),
    ...plan.items.map((t): Cell[] => [
      t.number,
      t.topic,
      t.hours,
      t.weekOrDate,
      t.note,
      t.isDone ? DONE[locale] : '',
    ]),
  ];
}

export function ktpXlsx(plan: KtpPlan, locale: Locale): Uint8Array {
  return buildXlsx({
    name: 'КТП',
    rows: ktpRows(plan, locale),
    widths: [6, 60, 7, 14, 30, 11],
    freeze: { rows: 2, cols: 1 },
  });
}
