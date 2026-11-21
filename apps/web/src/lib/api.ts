import type { ZodType } from 'zod';
import type { ApiError as ApiErrorBody } from '@sinf/shared';
import {
  ApiErrorSchema,
  ClassDetailsResponseSchema,
  CourseListResponseSchema,
  JoinClassesResponseSchema,
  JoinLookupResponseSchema,
  JoinRoomResponseSchema,
  ScreenshotUploadResponseSchema,
  SeatPlanSchema,
  type ScreenshotUpload,
  JoinResponseSchema,
  JoinSessionResponseSchema,
  LessonSchema,
  MeResponseSchema,
  PicsSchema,
  AuthoredLessonSchema,
  AuthoredLessonListResponseSchema,
  AssetUploadResponseSchema,
  CourseSchema,
  ClassProgramSchema,
  EmaktabRemindersResponseSchema,
  SchoolSettingsResponseSchema,
  KtpLessonsResponseSchema,
  KtpListResponseSchema,
  KtpPlanSchema,
  SessionKtpResponseSchema,
  ParsedTablesSchema,
  ProgramSchema,
  ProgramListResponseSchema,
  LibraryResponseSchema,
  LibraryReportsResponseSchema,
  PracticeResponseSchema,
  SessionResponseSchema,
  SessionStateSchema,
  StudentCodeResponseSchema,
  TeacherSchema,
  type CreateSession,
  type JoinRequest,
  AddStudentsResponseSchema,
  AdminSchoolListResponseSchema,
  ClassSummarySchema,
  DeviceListResponseSchema,
  DeviceSchema,
  type CreateDevice,
  SchoolBriefSchema,
  SchoolDetailsResponseSchema,
  SchoolListResponseSchema,
  type CreateSchool,
  type UpdateSchool,
  type AddStudents,
  type CreateClass,
  type TeacherLogin,
  type UpdateStudent,
  type TeacherRegister,
  SyncStatusSchema,
  QuizResponseSchema,
  JournalSchema,
  SessionResultsSchema,
  DemoStatusSchema,
  DemoResetResponseSchema,
  type AddVirtual,
  type AssetExtension,
  type AssetUploadResponse,
  type CreateAuthoredLesson,
  type Locale,
  type UpdateAuthoredLesson,
  type UpdateProgram,
  type AddKtpRow,
  type UpdateSchoolSettings,
  type ImportGrades,
  type SetEmaktab,
  type CreateKtp,
  type LinkKtpRows,
  type UpdateKtpRow,
  type LibraryKind,
  type SetJournalCell,
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
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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

/** A file's bytes as they are, for the server to read (lesson files, KTP). */
async function sendBytes<T>(url: string, bytes: Blob, schema: ZodType<T>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/octet-stream' },
    body: bytes,
  });
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
  quiz: (id: string) =>
    request('GET', `/api/lessons/${encodeURIComponent(id)}/quiz`, QuizResponseSchema),
  /** The lesson's practice task in a real program (H16); most lessons have none. */
  practice: (id: string) =>
    request('GET', `/api/lessons/${encodeURIComponent(id)}/practice`, PracticeResponseSchema),
  pics: (url: string) => request('GET', url, PicsSchema),
  /** The course a lesson plays in; a teacher's own lesson has one made for it (ADR-019). */
  lessonCourse: (id: string) =>
    request('GET', `/api/lessons/${encodeURIComponent(id)}/course`, CourseSchema),
  /** Teachers' own lessons (stage 4, W1): mine, or my school's. */
  authoredLessons: (scope: 'mine' | 'school' = 'mine') =>
    request('GET', `/api/authored-lessons?scope=${scope}`, AuthoredLessonListResponseSchema),
  authoredLesson: (id: string) =>
    request('GET', `/api/authored-lessons/${encodeURIComponent(id)}`, AuthoredLessonSchema),
  createAuthoredLesson: (body: CreateAuthoredLesson) =>
    request('POST', '/api/authored-lessons', AuthoredLessonSchema, body),
  saveAuthoredLesson: (id: string, body: UpdateAuthoredLesson) =>
    request('PUT', `/api/authored-lessons/${encodeURIComponent(id)}`, AuthoredLessonSchema, body),
  deleteAuthoredLesson: (id: string) =>
    request('DELETE', `/api/authored-lessons/${encodeURIComponent(id)}`, OkSchema),
  copyAuthoredLesson: (id: string) =>
    request('POST', `/api/authored-lessons/${encodeURIComponent(id)}/copy`, AuthoredLessonSchema),
  /** Programmes: lessons by quarters (W7). */
  programs: (scope: 'mine' | 'school' = 'mine') =>
    request('GET', `/api/programs?scope=${scope}`, ProgramListResponseSchema),
  program: (id: string) => request('GET', `/api/programs/${encodeURIComponent(id)}`, ProgramSchema),
  createProgram: (title: string, grade: number) =>
    request('POST', '/api/programs', ProgramSchema, { title, grade }),
  saveProgram: (id: string, body: UpdateProgram) =>
    request('PUT', `/api/programs/${encodeURIComponent(id)}`, ProgramSchema, body),
  deleteProgram: (id: string) =>
    request('DELETE', `/api/programs/${encodeURIComponent(id)}`, OkSchema),
  copyProgram: (id: string) =>
    request('POST', `/api/programs/${encodeURIComponent(id)}/copy`, ProgramSchema),
  classProgram: (classId: string) =>
    request('GET', `/api/classes/${encodeURIComponent(classId)}/program`, ClassProgramSchema),
  setClassProgram: (classId: string, programId: string | null) =>
    request('PUT', `/api/classes/${encodeURIComponent(classId)}/program`, ClassProgramSchema, {
      programId,
    }),
  /** The library (W8): public lessons and programmes. */
  library: (kind: LibraryKind, grade: number | null, q: string) => {
    const params = new URLSearchParams({
      kind,
      ...(grade ? { grade: String(grade) } : {}),
      ...(q ? { q } : {}),
    });
    return request('GET', `/api/library?${params.toString()}`, LibraryResponseSchema);
  },
  reportItem: (kind: LibraryKind, id: string, reason: string) =>
    request('POST', '/api/library/report', OkSchema, { kind, id, reason }),
  libraryReports: () => request('GET', '/api/admin/library/reports', LibraryReportsResponseSchema),
  moderate: (kind: LibraryKind, id: string, hidden: boolean) =>
    request('POST', `/api/admin/library/${kind}/${encodeURIComponent(id)}/moderate`, OkSchema, {
      hidden,
    }),
  /** A picture or a template of a lesson, as raw bytes (W1). */
  uploadAsset: (bytes: Blob, ext: AssetExtension): Promise<AssetUploadResponse> =>
    sendBytes(`/api/assets?ext=${ext}`, bytes, AssetUploadResponseSchema),
  /** The KTP (W10): the file's tables, then the rows the teacher mapped. */
  parseKtp: (bytes: Blob, name: string) =>
    sendBytes(`/api/ktp/parse?name=${encodeURIComponent(name)}`, bytes, ParsedTablesSchema),
  /** Tables of a file for the grades wizard (W13); works on a school computer too. */
  parseTables: (bytes: Blob, name: string) =>
    sendBytes(`/api/tables/parse?name=${encodeURIComponent(name)}`, bytes, ParsedTablesSchema),
  importGrades: (classId: string, body: ImportGrades) =>
    request('POST', `/api/journal/${encodeURIComponent(classId)}/import`, JournalSchema, body),
  ktpList: () => request('GET', '/api/ktp', KtpListResponseSchema),
  ktp: (id: string) => request('GET', `/api/ktp/${encodeURIComponent(id)}`, KtpPlanSchema),
  createKtp: (body: CreateKtp) => request('POST', '/api/ktp', KtpPlanSchema, body),
  deleteKtp: (id: string) =>
    request('DELETE', `/api/ktp/${encodeURIComponent(id)}`, KtpListResponseSchema),
  /** The KTP by hand and with lessons (W11). */
  updateKtpRow: (id: string, rowId: string, body: UpdateKtpRow) =>
    request(
      'PATCH',
      `/api/ktp/${encodeURIComponent(id)}/rows/${encodeURIComponent(rowId)}`,
      KtpPlanSchema,
      body,
    ),
  addKtpRow: (id: string, body: AddKtpRow) =>
    request('POST', `/api/ktp/${encodeURIComponent(id)}/rows`, KtpPlanSchema, body),
  deleteKtpRow: (id: string, rowId: string) =>
    request(
      'DELETE',
      `/api/ktp/${encodeURIComponent(id)}/rows/${encodeURIComponent(rowId)}`,
      KtpPlanSchema,
    ),
  linkKtp: (id: string, body: LinkKtpRows) =>
    request('POST', `/api/ktp/${encodeURIComponent(id)}/links`, KtpPlanSchema, body),
  ktpLessons: (id: string) =>
    request('GET', `/api/ktp/${encodeURIComponent(id)}/lessons`, KtpLessonsResponseSchema),
  sessionKtp: (sessionId: string) =>
    request('GET', `/api/sessions/${encodeURIComponent(sessionId)}/ktp`, SessionKtpResponseSchema),
  createSession: (body: CreateSession) =>
    request('POST', '/api/sessions', SessionResponseSchema, body),
  session: (id: string) =>
    request('GET', `/api/sessions/${encodeURIComponent(id)}`, SessionWithStateSchema),
  endSession: (id: string) =>
    request('POST', `/api/sessions/${encodeURIComponent(id)}/end`, SessionResponseSchema),
  demoStatus: () => request('GET', '/api/demo', DemoStatusSchema),
  addVirtual: (body: AddVirtual) => request('POST', '/api/demo/virtual', DemoStatusSchema, body),
  resetDemo: () => request('POST', '/api/demo/reset', DemoResetResponseSchema),
  sessionResults: (id: string) =>
    request('GET', `/api/sessions/${encodeURIComponent(id)}/results`, SessionResultsSchema),
  /** Confirm or change grades of a finished lesson; null goes back to the suggestion (H10). */
  setGrades: (sessionId: string, grades: { studentId: string; value: number | null }[]) =>
    request('PUT', `/api/sessions/${encodeURIComponent(sessionId)}/grades`, SessionResultsSchema, {
      grades,
    }),
  /** The teacher's marks on the practice's criteria; null gives one back (H16). */
  setPracticeMarks: (sessionId: string, studentId: string, marks: Record<string, boolean | null>) =>
    request(
      'PUT',
      `/api/sessions/${encodeURIComponent(sessionId)}/practice-marks`,
      SessionResultsSchema,
      { studentId, marks },
    ),
  /** A plain link: the browser downloads the practice file handed in. */
  practiceFileUrl: (sessionId: string, studentId: string) =>
    `/api/sessions/${encodeURIComponent(sessionId)}/practice/${encodeURIComponent(studentId)}/file`,
  /** The journal by hand (W9): a column without a lesson, one cell. */
  addJournalColumn: (classId: string, date: string, title: string) =>
    request('POST', `/api/journal/${encodeURIComponent(classId)}/columns`, JournalSchema, {
      date,
      title,
    }),
  deleteJournalColumn: (classId: string, columnId: string) =>
    request(
      'DELETE',
      `/api/journal/${encodeURIComponent(classId)}/columns/${encodeURIComponent(columnId)}`,
      JournalSchema,
    ),
  setJournalCell: (classId: string, body: SetJournalCell) =>
    request('PUT', `/api/journal/${encodeURIComponent(classId)}/cell`, JournalSchema, body),
  journal: (classId: string) =>
    request('GET', `/api/journal/${encodeURIComponent(classId)}`, JournalSchema),
  /** "Moved to eMaktab" for a column, and what still waits (W12). */
  setEmaktab: (classId: string, body: SetEmaktab) =>
    request('PUT', `/api/journal/${encodeURIComponent(classId)}/emaktab`, JournalSchema, body),
  emaktabReminders: () => request('GET', '/api/emaktab/reminders', EmaktabRemindersResponseSchema),
  /** A plain link, not a request: the browser downloads the file itself. */
  journalExportUrl: (classId: string, lang: Locale) =>
    `/api/journal/${encodeURIComponent(classId)}/export.xlsx?lang=${lang}`,
  setStarsToGrade: (classId: string, starsToGrade: boolean) =>
    request(
      'PATCH',
      `/api/classes/${encodeURIComponent(classId)}/settings`,
      ClassDetailsResponseSchema,
      { starsToGrade },
    ),
  /** The class's seating on the classroom's teacher computer; 404 anywhere else (H8). */
  seatPlan: (classId: string) =>
    request('GET', `/api/classes/${encodeURIComponent(classId)}/seats`, SeatPlanSchema),
  moveSeat: (classId: string, pc: string, studentId: string | null) =>
    request('PUT', `/api/classes/${encodeURIComponent(classId)}/seats`, SeatPlanSchema, {
      pc,
      studentId,
    }),
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
  schools: () => request('GET', '/api/schools', SchoolListResponseSchema),
  school: (id: string) =>
    request('GET', `/api/schools/${encodeURIComponent(id)}`, SchoolDetailsResponseSchema),
  requestSchool: (id: string) =>
    request('POST', `/api/schools/${encodeURIComponent(id)}/requests`, OkSchema),
  decideRequest: (schoolId: string, userId: string, decision: 'approve' | 'reject') =>
    request(
      'POST',
      `/api/schools/${encodeURIComponent(schoolId)}/requests/${encodeURIComponent(userId)}`,
      SchoolDetailsResponseSchema,
      { decision },
    ),
  setSchoolRole: (schoolId: string, userId: string, role: 'admin' | 'teacher') =>
    request(
      'POST',
      `/api/schools/${encodeURIComponent(schoolId)}/members/${encodeURIComponent(userId)}/role`,
      SchoolDetailsResponseSchema,
      { role },
    ),
  removeMember: (schoolId: string, userId: string) =>
    request(
      'DELETE',
      `/api/schools/${encodeURIComponent(schoolId)}/members/${encodeURIComponent(userId)}`,
      SchoolDetailsResponseSchema,
    ),
  /** The school's rules (stage 5, A1): its administrator only. */
  schoolSettings: (id: string) =>
    request('GET', `/api/schools/${encodeURIComponent(id)}/settings`, SchoolSettingsResponseSchema),
  updateSchoolSettings: (id: string, body: UpdateSchoolSettings) =>
    request(
      'PATCH',
      `/api/schools/${encodeURIComponent(id)}/settings`,
      SchoolSettingsResponseSchema,
      body,
    ),
  updateSchool: (id: string, body: UpdateSchool) =>
    request('PATCH', `/api/schools/${encodeURIComponent(id)}`, SchoolDetailsResponseSchema, body),
  devices: (schoolId: string) =>
    request(
      'GET',
      `/api/schools/${encodeURIComponent(schoolId)}/devices`,
      DeviceListResponseSchema,
    ),
  addDevice: (schoolId: string, body: CreateDevice) =>
    request(
      'POST',
      `/api/schools/${encodeURIComponent(schoolId)}/devices`,
      z.strictObject({ device: DeviceSchema }),
      body,
    ),
  newDeviceCode: (deviceId: string) =>
    request(
      'POST',
      `/api/devices/${encodeURIComponent(deviceId)}/code`,
      z.strictObject({ device: DeviceSchema }),
    ),
  removeDevice: (deviceId: string) =>
    request('DELETE', `/api/devices/${encodeURIComponent(deviceId)}`, DeviceListResponseSchema),
  adminSchools: () => request('GET', '/api/admin/schools', AdminSchoolListResponseSchema),
  createSchool: (body: CreateSchool) =>
    request('POST', '/api/admin/schools', z.strictObject({ school: SchoolBriefSchema }), body),
  assignSchoolAdmin: (id: string, email: string) =>
    request('POST', `/api/admin/schools/${encodeURIComponent(id)}/admins`, OkSchema, { email }),
  syncStatus: () => request('GET', '/api/sync/status', SyncStatusSchema),
  syncNow: () => request('POST', '/api/sync/now', SyncStatusSchema),
  joinClasses: () => request('GET', '/api/join/classes', JoinClassesResponseSchema),
  /** A classroom computer's screenshot, sent with the child's lesson token (H5). */
  uploadScreenshot: async (sessionId: string, token: string, body: ScreenshotUpload) => {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/screenshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-participant-token': token },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ApiError(res.status, 'http', `HTTP ${res.status}`);
    return ScreenshotUploadResponseSchema.parse(await res.json());
  },
  joinRoom: (pc: string) =>
    request('GET', `/api/join/room?pc=${encodeURIComponent(pc)}`, JoinRoomResponseSchema),
  joinLookup: (code: string) =>
    request('POST', '/api/join/lookup', JoinLookupResponseSchema, { code }),
  join: (body: JoinRequest) => request('POST', '/api/join', JoinResponseSchema, body),
  joinSession: (id: string) =>
    request('GET', `/api/join/session/${encodeURIComponent(id)}`, JoinSessionResponseSchema),
};
