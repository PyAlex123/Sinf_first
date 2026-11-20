import { randomUUID } from 'node:crypto';
import { and, count, eq, inArray } from 'drizzle-orm';
import { DEMO_CLASS_ID, DEMO_TEACHER_ID, type ClassSettings } from '@sinf/shared';
import { hashSecretSync } from '../auth/password.js';
import { CODE_SEPARATOR, DEFAULT_CODE_PICS } from '../services/codes.js';
import { schema, type Db } from './index.js';

/**
 * Demo data (STAGE1.md §5): Demo School, the demo teacher, class 1А with 20 fictional students.
 * Deterministic: ids, names and picture codes are fixed, so a reset returns exactly the same class.
 */

export const DEMO = {
  schoolId: 'school-demo',
  schoolName: 'Demo School',
  teacherId: DEMO_TEACHER_ID,
  teacherEmail: 'demo@sinf.local',
  teacherName: 'Демо Учитель',
  classId: DEMO_CLASS_ID,
  className: '1А',
  grade: 1,
  academicYear: '2025/2026',
  /** PICS keys (content/…/pics.json) used for picture codes; the seed test checks they exist. */
  codePics: DEFAULT_CODE_PICS,
} as const;

/** 20 fictional first graders: Uzbek and Russian names, no real children (STAGE1.md §1). */
export const DEMO_STUDENTS: readonly { lastName: string; firstName: string }[] = [
  { lastName: 'Алиев', firstName: 'Тимур' },
  { lastName: 'Каримова', firstName: 'Мадина' },
  { lastName: 'Иванов', firstName: 'Артём' },
  { lastName: 'Юсупова', firstName: 'Зухра' },
  { lastName: 'Петрова', firstName: 'Алина' },
  { lastName: 'Рахимов', firstName: 'Бекзод' },
  { lastName: 'Смирнов', firstName: 'Максим' },
  { lastName: 'Турсунова', firstName: 'Нилуфар' },
  { lastName: 'Абдуллаев', firstName: 'Жасур' },
  { lastName: 'Кузнецова', firstName: 'Варвара' },
  { lastName: 'Саидова', firstName: 'Камила' },
  { lastName: 'Ким', firstName: 'Даниил' },
  { lastName: 'Мирзаев', firstName: 'Азиз' },
  { lastName: 'Новикова', firstName: 'Дарья' },
  { lastName: 'Хасанова', firstName: 'Севара' },
  { lastName: 'Соколов', firstName: 'Егор' },
  { lastName: 'Умаров', firstName: 'Шахзод' },
  { lastName: 'Орлова', firstName: 'Полина' },
  { lastName: 'Назарова', firstName: 'Лола' },
  { lastName: 'Фёдоров', firstName: 'Илья' },
];

/**
 * Virtual students of the demo (S1.15): fictional too, and none of them shares a name with the class,
 * so on the teacher's screen nobody mistakes one for a child at a computer.
 */
export const VIRTUAL_STUDENTS: readonly { lastName: string; firstName: string }[] = [
  { lastName: 'Ахмедов', firstName: 'Санжар' },
  { lastName: 'Белова', firstName: 'Ксения' },
  { lastName: 'Валиева', firstName: 'Малика' },
  { lastName: 'Гусев', firstName: 'Тимофей' },
  { lastName: 'Давлатов', firstName: 'Ислом' },
  { lastName: 'Ершова', firstName: 'Ульяна' },
  { lastName: 'Жураев', firstName: 'Амир' },
  { lastName: 'Зайцева', firstName: 'Ева' },
  { lastName: 'Исмоилова', firstName: 'Дилноза' },
  { lastName: 'Карпов', firstName: 'Лев' },
  { lastName: 'Латипов', firstName: 'Отабек' },
  { lastName: 'Морозова', firstName: 'Софья' },
  { lastName: 'Нуриддинова', firstName: 'Шахзода' },
  { lastName: 'Осипов', firstName: 'Марк' },
  { lastName: 'Пулатов', firstName: 'Фарход' },
  { lastName: 'Родионова', firstName: 'Вера' },
  { lastName: 'Султанова', firstName: 'Мохира' },
  { lastName: 'Тихонов', firstName: 'Глеб' },
  { lastName: 'Усмонов', firstName: 'Жахонгир' },
  { lastName: 'Чернова', firstName: 'Мила' },
];

/**
 * Picture code of the n-th student: an ordered pair of two different pictures out of six (30 pairs).
 * Pairs are enumerated and taken with a stride of 7 (coprime with 30), so 20 students get 20 distinct codes
 * that do not look like a sequence on printed cards.
 */
export function pictureCode(
  index: number,
  pics: readonly string[] = DEMO.codePics,
): [string, string] {
  const pairs: [string, string][] = [];
  for (const a of pics) for (const b of pics) if (a !== b) pairs.push([a, b]);
  const pair = pairs[(index * 7) % pairs.length];
  if (!pair) throw new Error('No picture pairs');
  return pair;
}

export function isDatabaseEmpty(db: Db): boolean {
  const row = db.select({ n: count() }).from(schema.users).get();
  return (row?.n ?? 0) === 0;
}

export interface SeedOptions {
  teacherPassword: string;
  now?: () => Date;
}

const demoSettings = (): ClassSettings => ({
  starsToGrade: false,
  codePics: [...DEMO.codePics],
});

/** The 20 children of 1А, with their fixed ids and picture codes. */
function demoStudentRows() {
  return DEMO_STUDENTS.map((s, i) => {
    const code = pictureCode(i).join(CODE_SEPARATOR);
    return {
      id: `student-${String(i + 1).padStart(2, '0')}`,
      classId: DEMO.classId,
      firstName: s.firstName,
      lastName: s.lastName,
      codeKind: 'pics' as const,
      codeHash: hashSecretSync(code),
      codePublic: code,
      isVirtual: false,
      isActive: true,
      sortOrder: i + 1,
    };
  });
}

export interface SeedResult {
  students: number;
}

/** Inserts the demo data into an empty database. */
export function seedDemo(db: Db, options: SeedOptions): SeedResult {
  const now = (options.now ?? (() => new Date()))().toISOString();
  const settings = demoSettings();
  db.transaction((tx) => {
    tx.insert(schema.schools)
      .values({
        id: DEMO.schoolId,
        name: DEMO.schoolName,
        city: null,
        settings: {},
        createdAt: now,
      })
      .run();
    tx.insert(schema.users)
      .values({
        id: DEMO.teacherId,
        role: 'teacher',
        email: DEMO.teacherEmail,
        passwordHash: hashSecretSync(options.teacherPassword),
        fullName: DEMO.teacherName,
        locale: 'ru',
        createdAt: now,
      })
      .run();
    // The demo teacher belongs to the demo school; the demo class is the school's (ADR-009).
    tx.insert(schema.schoolMembers)
      .values({
        schoolId: DEMO.schoolId,
        userId: DEMO.teacherId,
        role: 'admin',
        createdAt: now,
      })
      .run();
    tx.insert(schema.classes)
      .values({
        id: DEMO.classId,
        schoolId: DEMO.schoolId,
        ownerId: DEMO.teacherId,
        name: DEMO.className,
        grade: DEMO.grade,
        academicYear: DEMO.academicYear,
        settings,
        createdAt: now,
      })
      .run();
    tx.insert(schema.students).values(demoStudentRows()).run();
    tx.insert(schema.classTeachers)
      .values({ classId: DEMO.classId, userId: DEMO.teacherId, createdAt: now })
      .run();
  });
  return { students: DEMO_STUDENTS.length };
}

/**
 * Our own account, taken from `.env` (S2.3). Only it creates schools, so it is not part of the demo
 * data: without the variables there is no superadmin at all. Runs on every start and is cheap:
 * when the account already exists nothing happens, the password is not touched.
 */
export function ensureSuperadmin(
  db: Db,
  credentials: { email: string; password: string },
  now = new Date(),
): { created: boolean } {
  const email = credentials.email.trim().toLowerCase();
  const existing = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  if (existing) {
    // Someone registered with this address as a teacher before the variable appeared: raise them.
    if (existing.role !== 'superadmin') {
      db.update(schema.users)
        .set({ role: 'superadmin' })
        .where(eq(schema.users.id, existing.id))
        .run();
      return { created: true };
    }
    return { created: false };
  }
  db.insert(schema.users)
    .values({
      id: randomUUID(),
      role: 'superadmin',
      email,
      passwordHash: hashSecretSync(credentials.password),
      fullName: 'Sinf',
      locale: 'ru',
      createdAt: now.toISOString(),
    })
    .run();
  return { created: true };
}

/**
 * Virtual students of the demo class, the first `count` of the pool (S1.15). Rows that already exist
 * are reused, so adding them lesson after lesson does not grow the class. They never log in by code:
 * the code columns hold nothing that would let them.
 */
export function ensureVirtualStudents(db: Db, howMany: number) {
  const wanted = VIRTUAL_STUDENTS.slice(0, howMany).map((s, i) => ({
    id: `virtual-${String(i + 1).padStart(2, '0')}`,
    classId: DEMO.classId,
    firstName: s.firstName,
    lastName: s.lastName,
    codeKind: 'pics' as const,
    codeHash: '-',
    codePublic: '',
    isVirtual: true,
    isActive: true,
    sortOrder: 1000 + i,
  }));
  if (wanted.length > 0) db.insert(schema.students).values(wanted).onConflictDoNothing().run();
  return db
    .select()
    .from(schema.students)
    .where(and(eq(schema.students.classId, DEMO.classId), eq(schema.students.isVirtual, true)))
    .orderBy(schema.students.sortOrder)
    .all();
}

/**
 * The demo, back to how it started (POST /api/demo/reset, S1.15): the lessons of class 1А and
 * everything they left, its virtual students, and the class itself with its 20 children. Nothing
 * outside the demo class is touched — on the platform other teachers and schools live beside it.
 */
export function resetDemoClass(db: Db, now = new Date()): SeedResult {
  return db.transaction((tx) => {
    const sessionIds = tx
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.classId, DEMO.classId))
      .all()
      .map((r) => r.id);
    if (sessionIds.length > 0) {
      for (const table of [
        schema.quizAttempts,
        schema.practiceResults,
        schema.screenResults,
        schema.activityEvents,
        schema.attendance,
      ]) {
        tx.delete(table).where(inArray(table.sessionId, sessionIds)).run();
      }
    }
    tx.delete(schema.grades).where(eq(schema.grades.classId, DEMO.classId)).run();
    tx.delete(schema.seats).where(eq(schema.seats.classId, DEMO.classId)).run();
    tx.delete(schema.sessions).where(eq(schema.sessions.classId, DEMO.classId)).run();
    tx.delete(schema.students).where(eq(schema.students.classId, DEMO.classId)).run();
    const cls = tx.select().from(schema.classes).where(eq(schema.classes.id, DEMO.classId)).get();
    if (cls) {
      tx.update(schema.classes)
        .set({ name: DEMO.className, grade: DEMO.grade, settings: demoSettings() })
        .where(eq(schema.classes.id, DEMO.classId))
        .run();
    } else {
      tx.insert(schema.classes)
        .values({
          id: DEMO.classId,
          schoolId: DEMO.schoolId,
          ownerId: DEMO.teacherId,
          name: DEMO.className,
          grade: DEMO.grade,
          academicYear: DEMO.academicYear,
          settings: demoSettings(),
          createdAt: now.toISOString(),
        })
        .run();
      tx.insert(schema.classTeachers)
        .values({ classId: DEMO.classId, userId: DEMO.teacherId, createdAt: now.toISOString() })
        .run();
    }
    tx.insert(schema.students).values(demoStudentRows()).run();
    return { students: DEMO_STUDENTS.length };
  });
}

/** Deletes everything and seeds again (`pnpm seed --reset` on a developer's machine only). */
export function resetDemo(db: Db, options: SeedOptions): SeedResult {
  return db.transaction((tx) => {
    for (const table of schema.TABLES_FOR_RESET) {
      tx.delete(table).run();
    }
    return seedDemo(tx, options);
  });
}
