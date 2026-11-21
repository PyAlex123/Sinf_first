import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type {
  AuthoredLessonDoc,
  CheckReport,
  ClassSettings,
  PracticeMarks,
  ProgramItem,
} from '@sinf/shared';

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
  city: text('city'),
  /**
   * CLAUDE.md §6: quotas, how long work is kept, how much of the KTP may change. All of it belongs to
   * features that do not exist yet, so the column starts empty and only the name and city are editable.
   */
  settings: text('settings', { mode: 'json' })
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: timestamp('created_at').notNull(),
});

export const users = sqliteTable(
  'users',
  {
    id: id(),
    /** CLAUDE.md §2. A student is not a user: they join a lesson by code (S1.7). */
    role: text('role', { enum: ['superadmin', 'school_admin', 'teacher'] }).notNull(),
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

/** Who belongs to a school and in which role (CLAUDE.md §6, SchoolMember). */
export const schoolMembers = sqliteTable(
  'school_members',
  {
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: ['admin', 'teacher'] }).notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.schoolId, t.userId] }),
    index('school_members_user_idx').on(t.userId),
  ],
);

/**
 * A school computer running our Windows app (S2.4, PLAN.md 6.2). The administrator adds the machine in
 * the cabinet and gets a pairing code; the app trades that code for its own token, which it then uses
 * to report in. `CLAUDE.md` §6 keeps the room as its own entity — here it is a plain field until rooms
 * earn a page of their own.
 */
export const devices = sqliteTable(
  'devices',
  {
    id: id(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id),
    /** What the administrator calls this machine: "ПК-05". */
    name: text('name').notNull(),
    room: text('room'),
    role: text('role', { enum: ['teacher', 'student'] }).notNull(),
    /** Shown until the machine pairs; then cleared, so one code is good for one computer. */
    pairingCode: text('pairing_code'),
    pairingExpiresAt: timestamp('pairing_expires_at'),
    /** Hash of the token the app keeps; null while the machine has not paired yet. */
    tokenHash: text('token_hash'),
    appVersion: text('app_version'),
    platform: text('platform'),
    lastSeenAt: timestamp('last_seen_at'),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [
    index('devices_school_idx').on(t.schoolId),
    uniqueIndex('devices_pairing_code_idx').on(t.pairingCode),
  ],
);

/** A teacher asks to join a school; its administrator decides (S2.3). */
export const schoolJoinRequests = sqliteTable(
  'school_join_requests',
  {
    id: id(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull(),
    createdAt: timestamp('created_at').notNull(),
    decidedAt: timestamp('decided_at'),
    decidedBy: text('decided_by').references(() => users.id),
  },
  (t) => [
    // One row per pair, so a teacher cannot queue twice; a rejected row is reused on a new request.
    uniqueIndex('school_join_requests_pair_idx').on(t.schoolId, t.userId),
    index('school_join_requests_school_idx').on(t.schoolId),
  ],
);

export const classes = sqliteTable(
  'classes',
  {
    id: id(),
    /** Null for a teacher's personal class; then `ownerId` says whose it is (CLAUDE.md §6). */
    schoolId: text('school_id').references(() => schools.id),
    /** Who created the class; for a personal class this is the only teacher. */
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    grade: integer('grade').notNull(),
    academicYear: text('academic_year').notNull(),
    settings: text('settings', { mode: 'json' }).$type<ClassSettings>().notNull(),
    createdAt: timestamp('created_at').notNull(),
    /**
     * Six digits printed on the cards: with them a child opens "Мои работы" at home (H12). Made by
     * the platform, carried to school computers with the roster.
     */
    homeCode: text('home_code'),
    /** The programme the class follows (stage 4, W7); it says which lesson comes next. */
    programId: text('program_id'),
  },
  (t) => [
    index('classes_school_idx').on(t.schoolId),
    index('classes_owner_idx').on(t.ownerId),
    uniqueIndex('classes_home_code_idx').on(t.homeCode),
  ],
);

/** Teachers of a school class (CLAUDE.md §6, ClassTeacher). A personal class has only its owner. */
export const classTeachers = sqliteTable(
  'class_teachers',
  {
    classId: text('class_id')
      .notNull()
      .references(() => classes.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.classId, t.userId] }),
    index('class_teachers_user_idx').on(t.userId),
  ],
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
    /**
     * School-computer mode (S2.6): when the platform accepted this lesson. Empty means "still
     * waiting for a connection", so this column is the queue — it survives any crash, and a lesson
     * can only leave the queue after the platform has said it has it.
     */
    syncedAt: timestamp('synced_at'),
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

/**
 * Stars the teacher gave for the drawing itself at the end of the Paint practice (S1.11). One row per
 * lesson per child: the drawing is one piece of work, however many steps it took.
 */
export const practiceResults = sqliteTable(
  'practice_results',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
    stars: integer('stars').notNull(),
    /** How many steps of the practice the child marked as done, as it stood at that moment. */
    stepsDone: integer('steps_done').notNull().default(0),
    at: timestamp('at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.studentId] })],
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

/**
 * A photograph of a classroom computer's screen (stage 3, H5; CLAUDE.md §4.8, §6 Screenshot): asked
 * for by the teacher, five lesson minutes before the practice ends and when it ends. The file lives
 * in `DATA_DIR/screenshots/<sessionId>/`; the row says whose and why. Thumbnails are never stored.
 */
export const screenshots = sqliteTable(
  'screenshots',
  {
    id: id(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
    kind: text('kind', { enum: ['manual', 'before_end', 'stage_end'] }).notNull(),
    takenAt: timestamp('taken_at').notNull(),
    /** Path under `DATA_DIR`, e.g. `screenshots/<sessionId>/<id>.jpg`. */
    fileKey: text('file_key').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    /** When the platform confirmed it has this picture (H10); empty while it waits for a connection. */
    syncedAt: timestamp('synced_at'),
  },
  (t) => [index('screenshots_session_idx').on(t.sessionId, t.studentId)],
);

/**
 * Seating (CLAUDE.md §4.1, §6 Seat; stage 3 step H2): who of this class sat at this classroom
 * computer last time, so the next lesson shows their name straight away. The computer is known by
 * the name the school gave it ("ПК-05"), because student computers are not registered as devices
 * yet (ADR-014). It lives on the teacher's computer only: seating is a fact about one room.
 */
export const seats = sqliteTable(
  'seats',
  {
    classId: text('class_id')
      .notNull()
      .references(() => classes.id),
    pc: text('pc').notNull(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
    lastUsedAt: timestamp('last_used_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.classId, t.pc] }), index('seats_student_idx').on(t.studentId)],
);

/**
 * The room's computers as the teacher's computer has heard of them (stage 3, H8): every student
 * computer that asked for the lesson. The seating editor lists them, so a computer stays there when
 * its child moves away, and shows up before anybody has logged in at it.
 */
export const roomComputers = sqliteTable('room_computers', {
  pc: text('pc').primaryKey(),
  lastSeenAt: timestamp('last_seen_at').notNull(),
});

/**
 * A grade the teacher confirmed or set for a child in a lesson (H10, ADR-012): `source` is `session`
 * when it is the suggested grade taken as it was, `manual` when the teacher chose another. Until
 * there is a row, the journal shows the calculated grade as a suggestion. One row per child and
 * lesson.
 */
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
    /** A grade in a column without a lesson (W9); null for a lesson's grade. */
    columnId: text('column_id'),
    /** "н" in a column without a lesson: the child was not there (W9). */
    absent: integer('absent', { mode: 'boolean' }).notNull().default(false),
    /** For a grade in a teacher's column: when it last changed, and when the platform took it. */
    updatedAt: timestamp('updated_at'),
    syncedAt: timestamp('synced_at'),
  },
  (t) => [
    index('grades_class_date_idx').on(t.classId, t.date),
    uniqueIndex('grades_session_student_idx').on(t.sessionId, t.studentId),
    uniqueIndex('grades_column_student_idx').on(t.columnId, t.studentId),
  ],
);

/**
 * A journal column without a lesson (PLAN.md 5.1; stage 4, W9): a test on paper, oral answers. Kept
 * on the computer where it was made and exchanged with the platform both ways, the newer winning.
 */
export const journalColumns = sqliteTable(
  'journal_columns',
  {
    id: id(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id),
    /** `YYYY-MM-DD`. */
    date: text('date').notNull(),
    title: text('title').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    deletedAt: timestamp('deleted_at'),
    syncedAt: timestamp('synced_at'),
  },
  (t) => [index('journal_columns_class_idx').on(t.classId, t.date)],
);

/**
 * Small persistent notes of the sync worker (S2.6): which roster version this computer holds, when
 * the platform last answered, what went wrong last time. A key-value table, because this is state of
 * the machine, not data of the school.
 */
export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: timestamp('updated_at').notNull(),
});

/**
 * A child's own files, "Мои работы" (CLAUDE.md §4.9; stage 3, H12; ADR-015). The bytes are kept once
 * per content in `DATA_DIR/files/<sha256>`; a row gives one of them a name in one child's folder.
 *
 * On a school computer a row also remembers what the platform has: `cloudSha` is the content the
 * platform confirmed under this name, and `dirty` says this computer has a change to send. A deleted
 * file stays as a row without content (`deletedAt`) until the platform has heard of it.
 */
export const studentFiles = sqliteTable(
  'student_files',
  {
    id: id(),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
    name: text('name').notNull(),
    /** Lower-case NFC: "Рисунок.PNG" and "рисунок.png" are one file, as on Windows. */
    nameKey: text('name_key').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256'),
    updatedAt: timestamp('updated_at').notNull(),
    /** Where the latest version came from: "ПК-05", "браузер", "облако". */
    origin: text('origin').notNull(),
    deletedAt: timestamp('deleted_at'),
    cloudSha: text('cloud_sha'),
    dirty: integer('dirty', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    uniqueIndex('student_files_name_idx').on(t.studentId, t.nameKey),
    index('student_files_sha_idx').on(t.sha256),
  ],
);

/**
 * A child's practice file at a lesson (CLAUDE.md §4.7–4.8, §6 CheckResult and Submission; stage 3,
 * H16). One row per child and lesson: the latest version checked, and the version handed in — frozen
 * with the photographs before the end of the practice. The bytes stay in the file store while either
 * version names them (`collect`), so a change after the lesson does not alter what was handed in.
 */
export const practiceChecks = sqliteTable(
  'practice_checks',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id),
    /** Null in a row that holds only the teacher's marks: the child saved nothing. */
    fileName: text('file_name'),
    fileSha: text('file_sha'),
    report: text('report', { mode: 'json' }).$type<CheckReport>(),
    checkedAt: timestamp('checked_at'),
    submittedName: text('submitted_name'),
    submittedSha: text('submitted_sha'),
    submittedReport: text('submitted_report', { mode: 'json' }).$type<CheckReport>(),
    submittedAt: timestamp('submitted_at'),
    /** The teacher's marks by criterion: manual ones, and automatic ones decided by hand. */
    marks: text('marks', { mode: 'json' }).$type<PracticeMarks>().notNull().default({}),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.studentId] }),
    index('practice_checks_file_idx').on(t.fileSha),
    index('practice_checks_submitted_idx').on(t.submittedSha),
  ],
);

/**
 * A teacher's own lesson (CLAUDE.md §4.3, §6 Lesson; stage 4, W1; ADR-019): its description and the
 * document the constructor edits. The engine plays it in the author's format (`authoredToLesson`).
 * Made and changed on the platform; a school computer holds a read-only copy of its school's.
 * A deleted lesson stays as a row: the results of the lessons held with it still need its screens.
 */
export const authoredLessons = sqliteTable(
  'authored_lessons',
  {
    id: id(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    grade: integer('grade').notNull(),
    topic: text('topic').notNull().default(''),
    visibility: text('visibility', { enum: ['private', 'school', 'public'] })
      .notNull()
      .default('private'),
    doc: text('doc', { mode: 'json' }).$type<AuthoredLessonDoc>().notNull(),
    /** Grows with every save; a save made from an older one is refused (two tabs). */
    version: integer('version').notNull().default(1),
    /** The lesson this one was copied from (the library, W8). */
    sourceId: text('source_id'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    deletedAt: timestamp('deleted_at'),
    /** Hidden from the library by the superadmin (W8); the author still has it. */
    hiddenAt: timestamp('hidden_at'),
  },
  (t) => [index('authored_lessons_owner_idx').on(t.ownerId)],
);

/**
 * A programme: lessons for a class by quarters (PLAN.md 3.8; stage 4, W7). Made on the platform;
 * the school computer keeps the programmes of its classes with the roster.
 */
export const programs = sqliteTable(
  'programs',
  {
    id: id(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    grade: integer('grade').notNull(),
    visibility: text('visibility', { enum: ['private', 'school', 'public'] })
      .notNull()
      .default('private'),
    items: text('items', { mode: 'json' }).$type<ProgramItem[]>().notNull(),
    version: integer('version').notNull().default(1),
    sourceId: text('source_id'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    deletedAt: timestamp('deleted_at'),
    hiddenAt: timestamp('hidden_at'),
  },
  (t) => [index('programs_owner_idx').on(t.ownerId)],
);

/** A teacher's complaint about a library item (PLAN.md 3.9; W8), until the superadmin acts. */
export const libraryReports = sqliteTable(
  'library_reports',
  {
    id: id(),
    kind: text('kind', { enum: ['lesson', 'program'] }).notNull(),
    itemId: text('item_id').notNull(),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => users.id),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at').notNull(),
    resolvedAt: timestamp('resolved_at'),
  },
  (t) => [index('library_reports_item_idx').on(t.kind, t.itemId)],
);

/**
 * The teacher's calendar-thematic plan for a class (PLAN.md 5.2–5.3; W10–W11; ADR-020). It lives on
 * the platform only: it is the teacher's paperwork, not part of a lesson in the classroom.
 */
export const ktpPlans = sqliteTable(
  'ktp_plans',
  {
    id: id(),
    teacherId: text('teacher_id')
      .notNull()
      .references(() => users.id),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id),
    title: text('title').notNull(),
    sourceFile: text('source_file').notNull().default(''),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    index('ktp_plans_teacher_idx').on(t.teacherId),
    index('ktp_plans_class_idx').on(t.classId),
  ],
);

/**
 * One topic of a KTP. `originalTopic` / `originalWeekOrDate` keep what the file said, to count the
 * share of changes the school allows (W11); a row added by hand has none; a removed one stays with
 * `deletedAt` for the same count.
 */
export const ktpRows = sqliteTable(
  'ktp_rows',
  {
    id: id(),
    planId: text('plan_id')
      .notNull()
      .references(() => ktpPlans.id),
    position: integer('position').notNull(),
    number: text('number').notNull().default(''),
    topic: text('topic').notNull(),
    hours: real('hours'),
    weekOrDate: text('week_or_date').notNull().default(''),
    note: text('note').notNull().default(''),
    originalTopic: text('original_topic'),
    originalWeekOrDate: text('original_week_or_date'),
    lessonId: text('lesson_id'),
    isDone: integer('is_done', { mode: 'boolean' }).notNull().default(false),
    doneAt: timestamp('done_at'),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => [index('ktp_rows_plan_idx').on(t.planId, t.position)],
);

/**
 * "Moved to eMaktab" for a journal column (PLAN.md 5.4; W12; ADR-012): a lesson's session or the
 * teacher's own column. Kept on the platform only: eMaktab itself is online.
 */
export const emaktabMarks = sqliteTable(
  'emaktab_marks',
  {
    classId: text('class_id')
      .notNull()
      .references(() => classes.id),
    /** The session's or the teacher's column's id. */
    columnId: text('column_id').notNull(),
    markedBy: text('marked_by')
      .notNull()
      .references(() => users.id),
    markedAt: timestamp('marked_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.classId, t.columnId] })],
);

/** Tables in a foreign-key-safe deletion order (children first). */
export const TABLES_FOR_RESET = [
  emaktabMarks,
  ktpRows,
  ktpPlans,
  journalColumns,
  libraryReports,
  programs,
  authoredLessons,
  practiceChecks,
  studentFiles,
  screenshots,
  seats,
  roomComputers,
  grades,
  quizAttempts,
  practiceResults,
  screenResults,
  activityEvents,
  attendance,
  sessions,
  students,
  classTeachers,
  classes,
  devices,
  schoolJoinRequests,
  schoolMembers,
  users,
  schools,
] as const;
