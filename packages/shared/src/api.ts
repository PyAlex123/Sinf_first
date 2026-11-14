import { z } from 'zod';
import { CourseSchema } from './lesson.js';
import { LocaleSchema } from './locale.js';
import { MAX_STUDENTS_PER_CLASS } from './roster.js';

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
  /** Extra machine-readable data, e.g. `attemptsLeft`, `retryAfterSec` for student login. */
  details: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ---------- teacher auth

export const TeacherLoginSchema = z.strictObject({
  email: z.email(),
  password: z.string().min(1),
});
export type TeacherLogin = z.infer<typeof TeacherLoginSchema>;

/** Registration on the public site (ADR-009). The password rule is deliberately simple for teachers. */
export const TeacherRegisterSchema = z.strictObject({
  email: z.email(),
  password: z.string().min(8, 'Пароль не короче 8 символов').max(200),
  fullName: z.string().trim().min(2).max(120),
  locale: LocaleSchema.optional(),
});
export type TeacherRegister = z.infer<typeof TeacherRegisterSchema>;

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
  /** Null for a teacher's personal class (ADR-009). */
  schoolId: id.nullable(),
  schoolName: z.string().min(1).nullable(),
});

/** Creating a class (S2.2). `schoolId` is only needed when the teacher belongs to several schools. */
export const CreateClassSchema = z.strictObject({
  name: z.string().trim().min(1).max(20),
  grade: z.number().int().min(1).max(11),
  /** "2025/2026"; the server fills in the current one when it is missing. */
  academicYear: z
    .string()
    .trim()
    .regex(/^\d{4}\/\d{4}$/)
    .optional(),
  schoolId: id.optional(),
});
export type CreateClass = z.infer<typeof CreateClassSchema>;
export type ClassSummary = z.infer<typeof ClassSummarySchema>;

export const SchoolRoleSchema = z.enum(['admin', 'teacher']);
export type SchoolRole = z.infer<typeof SchoolRoleSchema>;

/** A school as the teacher sees it from outside: enough to find their own and ask to join (S2.3). */
export const SchoolBriefSchema = z.strictObject({
  id,
  name: z.string().min(1),
  city: z.string().min(1).nullable(),
});
export type SchoolBrief = z.infer<typeof SchoolBriefSchema>;

export const SchoolListResponseSchema = z.strictObject({ schools: z.array(SchoolBriefSchema) });
export type SchoolListResponse = z.infer<typeof SchoolListResponseSchema>;

export const MySchoolSchema = SchoolBriefSchema.extend({ role: SchoolRoleSchema });
export type MySchool = z.infer<typeof MySchoolSchema>;

export const MeResponseSchema = z.strictObject({
  teacher: TeacherSchema,
  classes: z.array(ClassSummarySchema),
  /** Schools the teacher belongs to (S2.3). */
  schools: z.array(MySchoolSchema),
  /** The school they asked to join and are waiting for, if any. */
  pendingSchool: SchoolBriefSchema.nullable(),
  /** Only we see the superadmin area. */
  isSuperadmin: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// ---------- schools (S2.3)

export const SchoolMemberSchema = z.strictObject({
  userId: id,
  fullName: z.string().min(1),
  /** Only the administrator sees the addresses of their colleagues. */
  email: z.email().nullable(),
  role: SchoolRoleSchema,
});
export type SchoolMember = z.infer<typeof SchoolMemberSchema>;

export const SchoolClassSchema = z.strictObject({
  id,
  name: z.string().min(1),
  grade: z.number().int().min(1).max(11),
  studentCount: z.number().int().nonnegative(),
  teachers: z.array(z.string().min(1)),
});
export type SchoolClass = z.infer<typeof SchoolClassSchema>;

export const SchoolJoinRequestSchema = z.strictObject({
  userId: id,
  fullName: z.string().min(1),
  email: z.email(),
  createdAt: z.string().min(1),
});
export type SchoolJoinRequest = z.infer<typeof SchoolJoinRequestSchema>;

export const SchoolDetailsResponseSchema = z.strictObject({
  school: SchoolBriefSchema,
  role: SchoolRoleSchema,
  members: z.array(SchoolMemberSchema),
  classes: z.array(SchoolClassSchema),
  /** Empty for a plain teacher: requests are the administrator's business. */
  requests: z.array(SchoolJoinRequestSchema),
});
export type SchoolDetailsResponse = z.infer<typeof SchoolDetailsResponseSchema>;

export const CreateSchoolSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(60).optional(),
});
export type CreateSchool = z.infer<typeof CreateSchoolSchema>;

export const UpdateSchoolSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),
    city: z.string().trim().max(60).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.city !== undefined, 'Nothing to change');
export type UpdateSchool = z.infer<typeof UpdateSchoolSchema>;

export const SchoolDecisionSchema = z.strictObject({
  decision: z.enum(['approve', 'reject']),
});
export type SchoolDecision = z.infer<typeof SchoolDecisionSchema>;

export const SetSchoolRoleSchema = z.strictObject({ role: SchoolRoleSchema });
export type SetSchoolRole = z.infer<typeof SetSchoolRoleSchema>;

/** The superadmin list: the same brief plus how big the school already is. */
export const AdminSchoolSchema = SchoolBriefSchema.extend({
  teachers: z.number().int().nonnegative(),
  classes: z.number().int().nonnegative(),
  admins: z.array(z.string().min(1)),
});
export type AdminSchool = z.infer<typeof AdminSchoolSchema>;

export const AdminSchoolListResponseSchema = z.strictObject({
  schools: z.array(AdminSchoolSchema),
});
export type AdminSchoolListResponse = z.infer<typeof AdminSchoolListResponseSchema>;

export const AssignSchoolAdminSchema = z.strictObject({ email: z.email() });
export type AssignSchoolAdmin = z.infer<typeof AssignSchoolAdminSchema>;

// ---------- school computers (S2.4)

export const DeviceRoleSchema = z.enum(['teacher', 'student']);
export type DeviceRole = z.infer<typeof DeviceRoleSchema>;

export const DeviceSchema = z.strictObject({
  id,
  name: z.string().min(1),
  room: z.string().min(1).nullable(),
  role: DeviceRoleSchema,
  /** Shown to the administrator until the machine pairs; null afterwards and for a plain teacher. */
  pairingCode: z.string().min(1).nullable(),
  pairingExpiresAt: z.string().min(1).nullable(),
  paired: z.boolean(),
  appVersion: z.string().min(1).nullable(),
  lastSeenAt: z.string().min(1).nullable(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const DeviceListResponseSchema = z.strictObject({ devices: z.array(DeviceSchema) });
export type DeviceListResponse = z.infer<typeof DeviceListResponseSchema>;

export const CreateDeviceSchema = z.strictObject({
  name: z.string().trim().min(1).max(40),
  room: z.string().trim().max(40).optional(),
  role: DeviceRoleSchema.default('teacher'),
});
export type CreateDevice = z.infer<typeof CreateDeviceSchema>;

export const UpdateDeviceSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(40).optional(),
    room: z.string().trim().max(40).nullable().optional(),
    role: DeviceRoleSchema.optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.room !== undefined || v.role !== undefined,
    'Nothing to change',
  );
export type UpdateDevice = z.infer<typeof UpdateDeviceSchema>;

/** What the app sends when it trades a pairing code for its own token. */
export const PairDeviceSchema = z.strictObject({
  code: z.string().trim().min(4).max(16),
  appVersion: z.string().trim().min(1).max(40).optional(),
  platform: z.string().trim().min(1).max(60).optional(),
});
export type PairDevice = z.infer<typeof PairDeviceSchema>;

export const PairDeviceResponseSchema = z.strictObject({
  deviceId: id,
  /** Kept by the app; the server stores only its hash. */
  deviceToken: z.string().min(1),
  name: z.string().min(1),
  room: z.string().min(1).nullable(),
  role: DeviceRoleSchema,
  school: z.strictObject({ id, name: z.string().min(1) }),
});
export type PairDeviceResponse = z.infer<typeof PairDeviceResponseSchema>;

export const DeviceHeartbeatSchema = z.strictObject({
  appVersion: z.string().trim().min(1).max(40).optional(),
});
export type DeviceHeartbeat = z.infer<typeof DeviceHeartbeatSchema>;

/** The answer to a heartbeat: the app shows the school and the machine name in its window. */
export const DeviceStateResponseSchema = z.strictObject({
  deviceId: id,
  name: z.string().min(1),
  room: z.string().min(1).nullable(),
  role: DeviceRoleSchema,
  school: z.strictObject({ id, name: z.string().min(1) }),
  serverNow: z.string().min(1),
});
export type DeviceStateResponse = z.infer<typeof DeviceStateResponseSchema>;

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
  /** 1 = real time; 10 = demo speed, one lesson minute in six seconds (STAGE1 S1.8). */
  demoSpeed: z.number().int().positive().max(60).optional(),
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
  /** Lesson code, so a student without a token can be sent back to /join. */
  joinCode: z.string(),
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

const studentName = z.string().trim().min(1).max(60);

/** Adding a pasted roster (S2.2); the text itself is read by `parseRoster` before this. */
export const AddStudentsSchema = z.strictObject({
  students: z
    .array(z.strictObject({ lastName: studentName, firstName: studentName }))
    .min(1)
    .max(MAX_STUDENTS_PER_CLASS),
});
export type AddStudents = z.infer<typeof AddStudentsSchema>;

export const UpdateStudentSchema = z
  .strictObject({ lastName: studentName.optional(), firstName: studentName.optional() })
  .refine((v) => v.lastName !== undefined || v.firstName !== undefined, 'Nothing to change');
export type UpdateStudent = z.infer<typeof UpdateStudentSchema>;

/** Class details plus what the paste did: names already in the class are skipped, not duplicated. */
export const AddStudentsResponseSchema = ClassDetailsResponseSchema.extend({
  added: z.number().int().nonnegative(),
  skipped: z.array(z.string().min(1)),
});
export type AddStudentsResponse = z.infer<typeof AddStudentsResponseSchema>;

// ---------- student login (S1.7)

export const JoinLookupRequestSchema = z.strictObject({ code: z.string().regex(/^\d{4}$/) });
export type JoinLookupRequest = z.infer<typeof JoinLookupRequestSchema>;

export const JoinStudentSchema = z.strictObject({
  id,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  sortOrder: z.number().int().positive(),
});
export type JoinStudent = z.infer<typeof JoinStudentSchema>;

/** What a student sees after entering the lesson code: the class list and how codes look. */
export const JoinLookupResponseSchema = z.strictObject({
  session: z.strictObject({ id, lessonId: id, lessonTitle: z.string().min(1) }),
  class: z.strictObject({ id, name: z.string().min(1), grade: z.number().int() }),
  codeKind: z.enum(['pics', 'digits']),
  /** The six pictures of the class (PICS keys) for picture codes. */
  codePics: z.array(z.string().min(1)),
  students: z.array(JoinStudentSchema),
});
export type JoinLookupResponse = z.infer<typeof JoinLookupResponseSchema>;

export const JoinRequestSchema = z.strictObject({
  sessionId: id,
  studentId: id,
  /** Picture keys in order, or digits. */
  code: z.array(z.string().min(1)).min(1).max(6),
});
export type JoinRequest = z.infer<typeof JoinRequestSchema>;

export const JoinResponseSchema = z.strictObject({
  /** Secret for the WebSocket; kept in sessionStorage. */
  token: z.string().min(1),
  participantId: id,
  student: JoinStudentSchema,
  session: z.strictObject({ id, lessonId: id }),
});
export type JoinResponse = z.infer<typeof JoinResponseSchema>;
