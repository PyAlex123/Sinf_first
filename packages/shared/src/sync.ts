import { z } from 'zod';
import { ClassSettingsSchema, SchoolRoleSchema } from './api.js';
import { LocaleSchema } from './locale.js';
import { CheckReportSchema, PracticeMarksSchema } from './practice.js';
import { SyncProgramSchema } from './programs.js';

/**
 * What a school computer and the platform say to each other (S2.6, ADR-011).
 *
 * Two directions, both with the device token of S2.4:
 * — **down**: the school's own roster, so a lesson run on that computer is about real children with
 *   the platform's own identifiers;
 * — **up**: what the lesson produced, so the school's journal fills up even when the lesson itself
 *   happened with no internet at all (CLAUDE.md §3.3).
 *
 * Every identifier is made on the platform and carried through unchanged. That is what makes a
 * repeated send harmless: the receiving side writes by primary key, so the second send of the same
 * lesson changes nothing.
 */

const id = z.string().min(1);
const at = z.string().min(1);

// ---------- down: the school's roster

export const SyncTeacherSchema = z.strictObject({
  id,
  email: z.email(),
  fullName: z.string().min(1),
  locale: LocaleSchema,
  /** Role in this school, not on the platform: no password hash ever leaves the platform. */
  role: SchoolRoleSchema,
});
export type SyncTeacher = z.infer<typeof SyncTeacherSchema>;

export const SyncClassSchema = z.strictObject({
  id,
  ownerId: id,
  name: z.string().min(1),
  grade: z.number().int().min(1).max(11),
  academicYear: z.string().min(1),
  settings: ClassSettingsSchema,
  teacherIds: z.array(id),
  /** The code a child types at home to reach "Мои работы" (H12); printed on the cards. */
  homeCode: z.string().nullable().optional(),
  /** The class's programme (W7); absent from a platform before it. */
  programId: z.string().nullable().optional(),
});
export type SyncClass = z.infer<typeof SyncClassSchema>;

export const SyncStudentSchema = z.strictObject({
  id,
  classId: id,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  codeKind: z.enum(['pics', 'digits']),
  /** The computer checks the code itself while offline, so the hash travels with the student. */
  codeHash: z.string().min(1),
  codePublic: z.string().min(1),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});
export type SyncStudent = z.infer<typeof SyncStudentSchema>;

export const SchoolSnapshotSchema = z.strictObject({
  school: z.strictObject({ id, name: z.string().min(1), city: z.string().min(1).nullable() }),
  teachers: z.array(SyncTeacherSchema),
  classes: z.array(SyncClassSchema),
  students: z.array(SyncStudentSchema),
  /** The programmes of the school's classes (W7). */
  programs: z.array(SyncProgramSchema).optional(),
  /** Changes whenever anything above changes, so an unchanged roster is not rewritten. */
  version: z.string().min(1),
});
export type SchoolSnapshot = z.infer<typeof SchoolSnapshotSchema>;

// ---------- up: what the lesson produced

export const LessonSyncSessionSchema = z.strictObject({
  id,
  classId: id,
  lessonId: z.string().min(1),
  teacherId: id,
  startedAt: at,
  endedAt: at.nullable(),
  status: z.enum(['active', 'ended']),
});

export const LessonSyncAttendanceSchema = z.strictObject({
  studentId: id,
  status: z.enum(['present', 'absent']),
  joinedAt: at.nullable(),
});

export const LessonSyncScreenResultSchema = z.strictObject({
  studentId: id,
  screenIndex: z.number().int().nonnegative(),
  stars: z.number().int().min(0).max(3),
  attempts: z.number().int().positive(),
  firstAt: at,
  lastAt: at,
});

export const LessonSyncQuizAttemptSchema = z.strictObject({
  id,
  studentId: id,
  questionIndex: z.number().int().nonnegative(),
  optionIndex: z.number().int(),
  correct: z.boolean(),
  timeMs: z.number().int().nonnegative(),
  points: z.number().int(),
  at,
});

/** Stars the teacher gave for the drawing at the end of the Paint practice (S1.11). */
export const LessonSyncPracticeResultSchema = z.strictObject({
  studentId: id,
  stars: z.number().int().min(1).max(3),
  stepsDone: z.number().int().nonnegative(),
  at,
});

/** A grade the teacher confirmed or set after the lesson (H10, ADR-012). */
export const LessonSyncGradeSchema = z.strictObject({
  studentId: id,
  value: z.number().int().min(2).max(5),
  source: z.enum(['session', 'manual']),
  stars: z.number().int().nonnegative(),
  at,
});

/**
 * A child's practice file at the lesson (H16): the version handed in (or the latest one checked),
 * what the checker said and the teacher's marks. The file itself travels with "Мои работы" (H12).
 */
export const LessonSyncCheckSchema = z.strictObject({
  studentId: id,
  /** The three are null when the child saved nothing and only the teacher's marks are there. */
  fileName: z.string().min(1).max(260).nullable(),
  fileSha: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  report: CheckReportSchema.nullable(),
  marks: PracticeMarksSchema,
  checkedAt: at.nullable(),
  /** Set when this is the version handed in (CLAUDE.md §4.8). */
  submittedAt: at.nullable(),
});
export type LessonSyncCheck = z.infer<typeof LessonSyncCheckSchema>;

/**
 * One lesson as a whole. Attendance and stars are what the journal is made of (the author's choice
 * for this step); what happened during the lesson — raised hands, leaving the tab, "Attention!" —
 * stays on the computer where it is useful, and is not shipped to the cloud.
 */
export const LessonSyncBundleSchema = z.strictObject({
  session: LessonSyncSessionSchema,
  attendance: z.array(LessonSyncAttendanceSchema),
  screenResults: z.array(LessonSyncScreenResultSchema),
  practiceResults: z.array(LessonSyncPracticeResultSchema),
  quizAttempts: z.array(LessonSyncQuizAttemptSchema),
  /**
   * The lesson's confirmed grades as they stand now: the platform replaces what it holds for this
   * lesson with this list. Absent from a school computer that does not know grades yet (before H10).
   */
  grades: z.array(LessonSyncGradeSchema).optional(),
  /** Practice files and their criteria (H16), replaced as a whole like the grades. */
  checks: z.array(LessonSyncCheckSchema).optional(),
});
export type LessonSyncBundle = z.infer<typeof LessonSyncBundleSchema>;

export const LessonSyncResponseSchema = z.strictObject({
  ok: z.literal(true),
  sessionId: id,
  counts: z.strictObject({
    attendance: z.number().int().nonnegative(),
    screenResults: z.number().int().nonnegative(),
    practiceResults: z.number().int().nonnegative(),
    quizAttempts: z.number().int().nonnegative(),
  }),
});
export type LessonSyncResponse = z.infer<typeof LessonSyncResponseSchema>;

// ---------- school computer → platform: a screenshot of a lesson already sent (H10)

/**
 * One photograph of a child's screen, sent after its lesson has been accepted. The id was made where
 * the picture was taken, so sending it twice stores it once.
 */
export const ScreenshotSyncSchema = z.strictObject({
  id: z.string().uuid(),
  sessionId: id,
  studentId: id,
  kind: z.enum(['manual', 'before_end', 'stage_end']),
  takenAt: at,
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(4096),
  /** Base64 of a JPEG of at most 400 KB (CLAUDE.md §3.1). */
  jpeg: z.string().min(1).max(560_000),
});
export type ScreenshotSync = z.infer<typeof ScreenshotSyncSchema>;

export const ScreenshotSyncResponseSchema = z.strictObject({ ok: z.literal(true), id });
export type ScreenshotSyncResponse = z.infer<typeof ScreenshotSyncResponseSchema>;

// ---------- what the teacher sees on the school computer

export const SyncStatusSchema = z.strictObject({
  /** `platform` — this server is the platform itself and syncs nothing. */
  mode: z.enum(['platform', 'school']),
  /** Lessons waiting for a connection. */
  pending: z.number().int().nonnegative(),
  /** Screenshots of lessons already sent that are still waiting to go up (H10). */
  pendingShots: z.number().int().nonnegative().default(0),
  /** Changes in children's folders waiting to go up (H12). */
  pendingFiles: z.number().int().nonnegative().default(0),
  lastSyncAt: at.nullable(),
  lastError: z.string().nullable(),
  /** The roster this computer holds, if it ever received one. */
  rosterAt: at.nullable(),
});
export type SyncStatus = z.infer<typeof SyncStatusSchema>;
