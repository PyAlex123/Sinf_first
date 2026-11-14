import { count } from 'drizzle-orm';
import type { ClassSettings } from '@sinf/shared';
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
  teacherId: 'user-demo-teacher',
  teacherEmail: 'demo@sinf.local',
  teacherName: 'Демо Учитель',
  classId: 'class-1a',
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

export interface SeedResult {
  students: number;
}

/** Inserts the demo data into an empty database. */
export function seedDemo(db: Db, options: SeedOptions): SeedResult {
  const now = (options.now ?? (() => new Date()))().toISOString();
  const settings: ClassSettings = { starsToGrade: false, codePics: [...DEMO.codePics] };
  db.transaction((tx) => {
    tx.insert(schema.schools)
      .values({ id: DEMO.schoolId, name: DEMO.schoolName, createdAt: now })
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
    tx.insert(schema.students)
      .values(
        DEMO_STUDENTS.map((s, i) => {
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
        }),
      )
      .run();
    tx.insert(schema.classTeachers)
      .values({ classId: DEMO.classId, userId: DEMO.teacherId, createdAt: now })
      .run();
  });
  return { students: DEMO_STUDENTS.length };
}

/** Deletes everything and seeds again (POST /api/demo/reset, `pnpm seed --reset`). */
export function resetDemo(db: Db, options: SeedOptions): SeedResult {
  return db.transaction((tx) => {
    for (const table of schema.TABLES_FOR_RESET) {
      tx.delete(table).run();
    }
    return seedDemo(tx, options);
  });
}
