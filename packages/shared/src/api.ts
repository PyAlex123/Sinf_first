import { z } from 'zod';
import { CourseSchema } from './lesson.js';
import { LocaleSchema } from './locale.js';

/** HTTP API contracts (`/api/…`). The server validates requests with these schemas; the web client uses the types. */

const id = z.string().min(1);

// ---------- common

export const HealthResponseSchema = z.strictObject({ status: z.literal('ok') });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorSchema = z.strictObject({
  /** Machine-readable code: `unauthorized`, `not_found`, `validation`, `internal`. */
  error: z.string(),
  message: z.string(),
  issues: z.array(z.strictObject({ path: z.string(), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ---------- teacher auth

export const TeacherLoginSchema = z.strictObject({
  email: z.email(),
  password: z.string().min(1),
});
export type TeacherLogin = z.infer<typeof TeacherLoginSchema>;

export const TeacherSchema = z.strictObject({
  id,
  email: z.email(),
  fullName: z.string().min(1),
  locale: LocaleSchema,
});
export type Teacher = z.infer<typeof TeacherSchema>;

export const ClassSettingsSchema = z.strictObject({
  /** Convert stars to a 2–5 grade in results and journal. Off for the 1st grade. */
  starsToGrade: z.boolean(),
  /** PICS keys used for picture codes of this class (6 pictures). */
  codePics: z.array(z.string().min(1)).length(6),
});
export type ClassSettings = z.infer<typeof ClassSettingsSchema>;

export const ClassSummarySchema = z.strictObject({
  id,
  name: z.string().min(1),
  grade: z.number().int().min(1).max(11),
  academicYear: z.string().min(1),
  studentCount: z.number().int().nonnegative(),
  settings: ClassSettingsSchema,
});
export type ClassSummary = z.infer<typeof ClassSummarySchema>;

export const MeResponseSchema = z.strictObject({
  teacher: TeacherSchema,
  classes: z.array(ClassSummarySchema),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// ---------- content

export const CourseListResponseSchema = z.strictObject({ courses: z.array(CourseSchema) });
export type CourseListResponse = z.infer<typeof CourseListResponseSchema>;

// ---------- demo

export const DemoResetResponseSchema = z.strictObject({
  ok: z.literal(true),
  students: z.number().int().nonnegative(),
});
export type DemoResetResponse = z.infer<typeof DemoResetResponseSchema>;

// ---------- sessions (teacher) and joining (public)

export const CreateSessionSchema = z.strictObject({
  classId: id,
  lessonId: id,
});
export type CreateSession = z.infer<typeof CreateSessionSchema>;

export const SessionSummarySchema = z.strictObject({
  id,
  classId: id,
  lessonId: id,
  lessonTitle: z.string().min(1),
  joinCode: z.string().regex(/^\d{4}$/),
  status: z.enum(['active', 'ended']),
  startedAt: z.string().min(1),
  endedAt: z.string().nullable(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionResponseSchema = z.strictObject({ session: SessionSummarySchema });
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

/** Classes a student can pick on /join, each with its running lesson if any. */
export const JoinClassSchema = z.strictObject({
  id,
  name: z.string().min(1),
  grade: z.number().int().min(1).max(11),
  activeSession: z.strictObject({ id, lessonId: id, lessonTitle: z.string().min(1) }).nullable(),
});
export type JoinClass = z.infer<typeof JoinClassSchema>;

export const JoinClassesResponseSchema = z.strictObject({ classes: z.array(JoinClassSchema) });
export type JoinClassesResponse = z.infer<typeof JoinClassesResponseSchema>;

export const JoinSessionResponseSchema = z.strictObject({
  id,
  lessonId: id,
  status: z.enum(['active', 'ended']),
});
export type JoinSessionResponse = z.infer<typeof JoinSessionResponseSchema>;

// ---------- class and student codes (teacher)

export const StudentSchema = z.strictObject({
  id,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  sortOrder: z.number().int().positive(),
  isActive: z.boolean(),
  codeKind: z.enum(['pics', 'digits']),
  /** Public code: PICS keys in order for `pics`, single digits for `digits`. Stage 1 only (ADR-004). */
  code: z.array(z.string().min(1)).min(1),
});
export type Student = z.infer<typeof StudentSchema>;

export const ClassDetailsResponseSchema = z.strictObject({
  class: ClassSummarySchema,
  students: z.array(StudentSchema),
});
export type ClassDetailsResponse = z.infer<typeof ClassDetailsResponseSchema>;

export const StudentCodeResponseSchema = z.strictObject({ student: StudentSchema });
export type StudentCodeResponse = z.infer<typeof StudentCodeResponseSchema>;
