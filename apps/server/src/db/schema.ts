import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { ClassSettings } from '@sinf/shared';

/**
 * Stage 1 schema (STAGE1.md S1.3, docs/stage1-architecture.md §3). Portable to PostgreSQL:
 * text ids (UUID), ISO-8601 UTC timestamps in text columns, JSON in text columns, booleans as integers.
 * Lessons are not stored here: they are read from content/ (ADR-005).
 */

const timestamp = (name: string) => text(name);
const id = (name = 'id') => text(name).primaryKey();

export const schools = sqliteTable('schools', {
  id: id(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull(),
});

export const users = sqliteTable(
  'users',
  {
    id: id(),
    role: text('role', { enum: ['teacher'] }).notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    locale: text('locale', { enum: ['uz', 'ru'] })
      .notNull()
      .default('ru'),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
);

export const classes = sqliteTable(
  'classes',
  {
    id: id(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id),
    name: text('name').notNull(),
    grade: integer('grade').notNull(),
    academicYear: text('academic_year').notNull(),
    settings: text('settings', { mode: 'json' }).$type<ClassSettings>().notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [index('classes_school_idx').on(t.schoolId)],
);

export const students = sqliteTable(
  'students',
  {
    id: id(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    codeKind: text('code_kind', { enum: ['pics', 'digits'] }).notNull(),
    codeHash: text('code_hash').notNull(),
    /** Plain code for printing cards. Stage 1 only (fictional students); the full version keeps the hash only. */
    codePublic: text('code_public').notNull(),
    isVirtual: integer('is_virtual', { mode: 'boolean' }).notNull().default(false),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [index('students_class_idx').on(t.classId)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id),
    /** Lesson id from content/ (e.g. `g10`). */
    lessonId: text('lesson_id').notNull(),
    teacherId: text('teacher_id')
      .notNull()
      .references(() => users.id),
    joinCode: text('join_code').notNull(),
    status: text('status', { enum: ['active', 'ended'] }).notNull(),
    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at'),
    demoSpeed: integer('demo_speed').notNull().default(1),
    /** Snapshot of the in-memory session state (ADR-006). */
    stateJson: text('state_json', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (t) => [
    index('sessions_class_idx').on(t.classId),
    index('sessions_join_code_idx').on(t.joinCode),
  ],
);

export const attendance = sqliteTable(
  'attendance',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
    status: text('status', { enum: ['present', 'absent'] }).notNull(),
    joinedAt: timestamp('joined_at'),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.studentId] })],
);

export const activityEvents = sqliteTable(
  'activity_events',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    studentId: text('student_id').references(() => students.id),
    type: text('type').notNull(),
    at: timestamp('at').notNull(),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (t) => [index('activity_events_session_idx').on(t.sessionId)],
);

/** Stars for one lesson screen (trainer level or "type the word"). */
export const screenResults = sqliteTable(
  'screen_results',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
    screenIndex: integer('screen_index').notNull(),
    stars: integer('stars').notNull(),
    attempts: integer('attempts').notNull().default(1),
    firstAt: timestamp('first_at').notNull(),
    lastAt: timestamp('last_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.studentId, t.screenIndex] })],
);

export const quizAttempts = sqliteTable(
  'quiz_attempts',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
    questionIndex: integer('question_index').notNull(),
    optionIndex: integer('option_index').notNull(),
    correct: integer('correct', { mode: 'boolean' }).notNull(),
    timeMs: integer('time_ms').notNull(),
    points: integer('points').notNull(),
    at: timestamp('at').notNull(),
  },
  (t) => [index('quiz_attempts_session_idx').on(t.sessionId)],
);

/** Journal row: stars for a lesson and, if the class converts them, a 2–5 grade. */
export const grades = sqliteTable(
  'grades',
  {
    id: id(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id),
    sessionId: text('session_id').references(() => sessions.id),
    /** Lesson date, `YYYY-MM-DD`. */
    date: text('date').notNull(),
    stars: integer('stars').notNull().default(0),
    value: integer('value'),
    source: text('source', { enum: ['session', 'manual'] }).notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [index('grades_class_date_idx').on(t.classId, t.date)],
);

/** Tables in a foreign-key-safe deletion order (children first). */
export const TABLES_FOR_RESET = [
  grades,
  quizAttempts,
  screenResults,
  activityEvents,
  attendance,
  sessions,
  students,
  classes,
  users,
  schools,
] as const;
