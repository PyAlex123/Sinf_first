import type { ZodType } from 'zod';
import type { ApiError as ApiErrorBody } from '@sinf/shared';
import {
  ApiErrorSchema,
  ClassDetailsResponseSchema,
  CourseListResponseSchema,
  JoinClassesResponseSchema,
  JoinLookupResponseSchema,
  JoinResponseSchema,
  JoinSessionResponseSchema,
  LessonSchema,
  MeResponseSchema,
  PicsSchema,
  SessionResponseSchema,
  SessionStateSchema,
  StudentCodeResponseSchema,
  TeacherSchema,
  type CreateSession,
  type JoinRequest,
  AddStudentsResponseSchema,
  ClassSummarySchema,
  type AddStudents,
  type CreateClass,
  type TeacherLogin,
  type UpdateStudent,
  type TeacherRegister,
} from '@sinf/shared';
import { z } from 'zod';

/** Typed HTTP client: every response is checked against the shared schema. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Extra data from the server, e.g. `attemptsLeft` or `retryAfterSec`. */
    readonly details?: ApiErrorBody['details'],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  schema: ZodType<T>,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(json);
    throw parsed.success
      ? new ApiError(res.status, parsed.data.error, parsed.data.message, parsed.data.details)
      : new ApiError(res.status, 'http', `HTTP ${res.status}`);
  }
  return schema.parse(json);
}

const LoginResponseSchema = z.strictObject({ teacher: TeacherSchema });
const OkSchema = z.strictObject({ ok: z.literal(true) });
const SessionWithStateSchema = SessionResponseSchema.extend({
  state: SessionStateSchema.nullable(),
});

export const api = {
  register: (body: TeacherRegister) =>
    request('POST', '/api/auth/register', LoginResponseSchema, body),
  login: (body: TeacherLogin) => request('POST', '/api/auth/teacher', LoginResponseSchema, body),
  logout: () => request('DELETE', '/api/auth/teacher', OkSchema),
  me: () => request('GET', '/api/me', MeResponseSchema),
  courses: () => request('GET', '/api/courses', CourseListResponseSchema),
  lesson: (id: string) => request('GET', `/api/lessons/${encodeURIComponent(id)}`, LessonSchema),
  pics: (url: string) => request('GET', url, PicsSchema),
  createSession: (body: CreateSession) =>
    request('POST', '/api/sessions', SessionResponseSchema, body),
  session: (id: string) =>
    request('GET', `/api/sessions/${encodeURIComponent(id)}`, SessionWithStateSchema),
  endSession: (id: string) =>
    request('POST', `/api/sessions/${encodeURIComponent(id)}/end`, SessionResponseSchema),
  classDetails: (id: string) =>
    request('GET', `/api/classes/${encodeURIComponent(id)}`, ClassDetailsResponseSchema),
  createClass: (body: CreateClass) =>
    request('POST', '/api/classes', z.strictObject({ class: ClassSummarySchema }), body),
  addStudents: (classId: string, body: AddStudents) =>
    request(
      'POST',
      `/api/classes/${encodeURIComponent(classId)}/students`,
      AddStudentsResponseSchema,
      body,
    ),
  updateStudent: (studentId: string, body: UpdateStudent) =>
    request(
      'PATCH',
      `/api/students/${encodeURIComponent(studentId)}`,
      ClassDetailsResponseSchema,
      body,
    ),
  removeStudent: (studentId: string) =>
    request('DELETE', `/api/students/${encodeURIComponent(studentId)}`, ClassDetailsResponseSchema),
  reissueCode: (studentId: string) =>
    request(
      'POST',
      `/api/students/${encodeURIComponent(studentId)}/code`,
      StudentCodeResponseSchema,
    ),
  joinClasses: () => request('GET', '/api/join/classes', JoinClassesResponseSchema),
  joinLookup: (code: string) =>
    request('POST', '/api/join/lookup', JoinLookupResponseSchema, { code }),
  join: (body: JoinRequest) => request('POST', '/api/join', JoinResponseSchema, body),
  joinSession: (id: string) =>
    request('GET', `/api/join/session/${encodeURIComponent(id)}`, JoinSessionResponseSchema),
};
