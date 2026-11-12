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
