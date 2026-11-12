import type { ZodType } from 'zod';
import {
  ApiErrorSchema,
  ClassDetailsResponseSchema,
  CourseListResponseSchema,
  JoinClassesResponseSchema,
  JoinSessionResponseSchema,
  LessonSchema,
  MeResponseSchema,
  PicsSchema,
  SessionResponseSchema,
  SessionStateSchema,
  StudentCodeResponseSchema,
  TeacherSchema,
  type CreateSession,
  type TeacherLogin,
} from '@sinf/shared';
import { z } from 'zod';

/** Typed HTTP client: every response is checked against the shared schema. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'DELETE',
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
      ? new ApiError(res.status, parsed.data.error, parsed.data.message)
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
  reissueCode: (studentId: string) =>
    request(
      'POST',
      `/api/students/${encodeURIComponent(studentId)}/code`,
      StudentCodeResponseSchema,
    ),
  joinClasses: () => request('GET', '/api/join/classes', JoinClassesResponseSchema),
  joinSession: (id: string) =>
    request('GET', `/api/join/session/${encodeURIComponent(id)}`, JoinSessionResponseSchema),
};
