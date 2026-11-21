import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { CreateKtp, KtpPlan, KtpPlanSummary, KtpRow, Locale } from '@sinf/shared';
import type { ContentStore } from '../content/index.js';
import { schema, type Db } from '../db/index.js';
import { notFound } from '../errors.js';
import { buildXlsx, type Cell } from './xlsx.js';

/**
 * The teacher's KTP (PLAN.md 5.2; stage 4, W10; ADR-020): saved from the import wizard, shown
 * row by row, and given back as an Excel file in the same columns.
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

function summaryOf(db: Db, plan: PlanRow, topics: TopicRow[]): KtpPlanSummary {
  return {
    id: plan.id,
    classId: plan.classId,
    className: className(db, plan.classId),
    title: plan.title,
    sourceFile: plan.sourceFile,
    rows: topics.length,
    done: topics.filter((t) => t.isDone).length,
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

export function ktpPlan(db: Db, content: ContentStore, plan: PlanRow): KtpPlan {
  const topics = topicsOf(db, plan.id);
  return {
    ...summaryOf(db, plan, topics),
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
    })),
  };
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
};
const DONE: Record<Locale, string> = { ru: 'да', uz: 'ha' };

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
