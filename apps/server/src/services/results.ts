import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import {
  DEFAULT_GRADE_THRESHOLDS,
  gradeFor,
  GradeValueSchema,
  lessonDate,
  practiceStepCount,
  PRACTICE_MAX_STARS,
  practiceScore,
  scorePercent,
  SessionStateSchema,
  trainerMaxStars,
  type ClassSettings,
  type Journal,
  type JournalCell,
  type ResultCheck,
  type ResultPractice,
  type ResultRow,
  type SessionResults,
  type PracticeTask,
  type SetGrades,
} from '@sinf/shared';
import type { ContentStore } from '../content/index.js';
import { schema, type Db } from '../db/index.js';
import { ApiHttpError } from '../errors.js';

/**
 * Lesson results and the class journal (S1.13, ADR-012), worked out from the rows a lesson leaves:
 * `attendance`, `screen_results`, `practice_results`, `quiz_attempts`. These are the very rows that
 * travel to the platform (S2.6), so a lesson reads the same in the classroom and in the cloud.
 */

type SessionRow = typeof schema.sessions.$inferSelect;
type StudentRow = typeof schema.students.$inferSelect;
type ClassRow = typeof schema.classes.$inferSelect;

/** Surname, then first name — the order of a school register. */
export function byStudentName(
  a: { lastName: string; firstName: string },
  b: { lastName: string; firstName: string },
): number {
  return a.lastName.localeCompare(b.lastName, 'ru') || a.firstName.localeCompare(b.firstName, 'ru');
}

const fullName = (s: { lastName: string; firstName: string }): string =>
  `${s.lastName} ${s.firstName}`;

/** Everything a set of lessons left behind, read in four queries whatever the number of lessons. */
function loadRows(db: Db, sessionIds: string[]) {
  if (sessionIds.length === 0) {
    return {
      attendance: [],
      screens: [],
      practice: [],
      checks: [],
      quiz: [],
      shots: [],
      grades: [],
    };
  }
  return {
    attendance: db
      .select()
      .from(schema.attendance)
      .where(inArray(schema.attendance.sessionId, sessionIds))
      .all(),
    screens: db
      .select()
      .from(schema.screenResults)
      .where(inArray(schema.screenResults.sessionId, sessionIds))
      .all(),
    practice: db
      .select()
      .from(schema.practiceResults)
      .where(inArray(schema.practiceResults.sessionId, sessionIds))
      .all(),
    checks: db
      .select()
      .from(schema.practiceChecks)
      .where(inArray(schema.practiceChecks.sessionId, sessionIds))
      .all(),
    quiz: db
      .select()
      .from(schema.quizAttempts)
      .where(inArray(schema.quizAttempts.sessionId, sessionIds))
      .all(),
    shots: db
      .select({
        id: schema.screenshots.id,
        sessionId: schema.screenshots.sessionId,
        studentId: schema.screenshots.studentId,
        takenAt: schema.screenshots.takenAt,
      })
      .from(schema.screenshots)
      .where(inArray(schema.screenshots.sessionId, sessionIds))
      .all(),
    grades: db
      .select()
      .from(schema.grades)
      .where(inArray(schema.grades.sessionId, sessionIds))
      .all(),
  };
}

type Rows = ReturnType<typeof loadRows>;

/**
 * Paint steps each child marked, from the lesson's last snapshot. Only the computer the lesson ran
 * on has it (the snapshot does not travel); elsewhere the count saved with the stars is used.
 */
function stepsFromSnapshot(session: SessionRow): Map<string, number> {
  const steps = new Map<string, number>();
  const raw = (session.stateJson as { state?: unknown } | null)?.state;
  const parsed = raw ? SessionStateSchema.safeParse(raw) : null;
  if (!parsed?.success) return steps;
  for (const p of Object.values(parsed.data.participants)) {
    if (p.studentId) steps.set(p.studentId, p.steps.length);
  }
  return steps;
}

type CheckRow = typeof schema.practiceChecks.$inferSelect;

/**
 * A child's practice at the lesson (H16): what was handed in, or until then the version checked last,
 * with the teacher's marks over the checker's verdicts. Null when the child neither saved nor was
 * marked.
 */
function resultCheck(task: PracticeTask, row: CheckRow | undefined): ResultCheck | null {
  if (!row) return null;
  const handedIn = !!row.submittedSha && !!row.submittedReport;
  const report = handedIn ? row.submittedReport : row.report;
  const score = practiceScore(task, report, row.marks);
  const found: Record<string, string> = {};
  for (const r of report?.results ?? []) if (r.found) found[r.id] = r.found;
  return {
    fileName: (handedIn ? row.submittedName : row.fileName) ?? null,
    file: report?.file ?? null,
    outcomes: score.outcomes,
    found,
    marks: row.marks,
    points: score.points,
    max: score.max,
    submitted: handedIn,
    checkedAt: (handedIn ? row.submittedAt : row.checkedAt) ?? null,
  };
}

function computeSession(
  session: SessionRow,
  cls: ClassRow,
  students: StudentRow[],
  rows: Rows,
  content: ContentStore,
): SessionResults {
  const lesson = content.getLesson(session.lessonId);
  const quiz = content.getQuiz(session.lessonId);
  const task = content.getPractice(session.lessonId) ?? null;
  const mine = <T extends { sessionId: string }>(list: T[]): T[] =>
    list.filter((r) => r.sessionId === session.id);
  const attendance = mine(rows.attendance);
  const screens = mine(rows.screens);
  const practice = mine(rows.practice);
  const answers = mine(rows.quiz);
  const shots = mine(rows.shots);
  const confirmed = rows.grades.filter((g) => g.sessionId === session.id);
  const checks = mine(rows.checks);

  const practiceSteps = lesson ? practiceStepCount(lesson) : 0;
  const maxima = {
    trainer: lesson ? trainerMaxStars(lesson) : 0,
    // The drawing counts once the teacher has started giving stars for it (ADR-012).
    practice: practiceSteps > 0 && practice.length > 0 ? PRACTICE_MAX_STARS : 0,
    // Questions that were really asked: someone answered them.
    quiz: new Set(answers.map((a) => a.questionIndex)).size,
    // The practice in a real program counts once anybody saved a file or was marked (H16).
    check: task && checks.length > 0 ? task.criteria.reduce((sum, c) => sum + c.points, 0) : 0,
  };
  const settings: ClassSettings = cls.settings;
  const thresholds = settings.gradeThresholds ?? DEFAULT_GRADE_THRESHOLDS;
  const snapshotSteps = stepsFromSnapshot(session);

  // The children of this lesson: those on its attendance list, plus anyone with a result.
  const ids = new Set<string>([
    ...attendance.map((a) => a.studentId),
    ...screens.map((r) => r.studentId),
    ...practice.map((r) => r.studentId),
    ...checks.map((r) => r.studentId),
    ...answers.map((r) => r.studentId),
  ]);
  const people = students.filter((s) => ids.has(s.id)).sort(byStudentName);

  const result: ResultRow[] = people.map((student) => {
    const present =
      attendance.find((a) => a.studentId === student.id)?.status === 'present' ||
      // A result without an attendance row still means the child was there.
      !attendance.some((a) => a.studentId === student.id);
    const ownScreens = screens.filter((r) => r.studentId === student.id);
    const ownPractice = practice.find((r) => r.studentId === student.id);
    const ownAnswers = answers.filter((r) => r.studentId === student.id);
    const trainerStars = ownScreens.reduce((sum, r) => sum + r.stars, 0);
    const practiceStars = ownPractice?.stars ?? null;
    const quizCorrect = ownAnswers.filter((a) => a.correct).length;
    const check = task
      ? resultCheck(
          task,
          checks.find((c) => c.studentId === student.id),
        )
      : null;
    const percent = present
      ? scorePercent(
          {
            trainerStars,
            practiceStars: practiceStars ?? 0,
            quizCorrect,
            checkPoints: check?.points ?? 0,
          },
          maxima,
        )
      : null;
    // The latest photograph is the one that counts: the practice as it ended (H5).
    const shot = shots
      .filter((s) => s.studentId === student.id)
      .reduce<(typeof shots)[number] | null>((a, b) => (!a || b.takenAt > a.takenAt ? b : a), null);
    // The teacher's word stands over the calculation (H10); until then the calculation is offered.
    const suggestedGrade =
      settings.starsToGrade && percent !== null ? gradeFor(percent, thresholds) : null;
    const own = confirmed.find((g) => g.studentId === student.id);
    const ownGrade = own?.value != null ? GradeValueSchema.safeParse(own.value) : null;
    const confirmedGrade = ownGrade?.success ? ownGrade.data : null;
    return {
      studentId: student.id,
      name: fullName(student),
      screenshotId: shot?.id ?? null,
      isActive: student.isActive,
      isVirtual: student.isVirtual,
      present,
      trainerStars,
      screensDone: ownScreens.length,
      practiceStars,
      stepsDone:
        practiceSteps > 0
          ? (snapshotSteps.get(student.id) ?? ownPractice?.stepsDone ?? null)
          : null,
      quizPoints: ownAnswers.reduce((sum, a) => sum + a.points, 0),
      quizCorrect,
      quizAnswered: ownAnswers.length,
      check,
      totalStars: trainerStars + (practiceStars ?? 0),
      percent,
      grade: confirmedGrade ?? suggestedGrade,
      suggestedGrade,
      gradeConfirmed: confirmedGrade !== null,
    };
  });

  return {
    sessionId: session.id,
    lessonId: session.lessonId,
    lessonTitle: lesson?.title ?? session.lessonId,
    status: session.status,
    date: lessonDate(session.startedAt),
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    class: {
      id: cls.id,
      name: cls.name,
      starsToGrade: settings.starsToGrade,
      thresholds,
    },
    maxima,
    practice: task
      ? ({
          app: task.app,
          fileName: task.fileName,
          criteria: task.criteria.map((c) => ({
            id: c.id,
            kind: c.kind,
            label: c.label,
            points: c.points,
          })),
        } satisfies ResultPractice)
      : null,
    practiceSteps,
    quizQuestions: quiz?.questions.length ?? 0,
    presentCount: result.filter((r) => r.present).length,
    rows: result,
  };
}

function classOf(db: Db, classId: string): ClassRow | undefined {
  return db.select().from(schema.classes).where(eq(schema.classes.id, classId)).get();
}

function studentsOf(db: Db, classId: string): StudentRow[] {
  return db.select().from(schema.students).where(eq(schema.students.classId, classId)).all();
}

/** Results of one lesson, ended or still running. The caller has already checked access. */
export function sessionResults(
  db: Db,
  content: ContentStore,
  sessionId: string,
): SessionResults | undefined {
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
  if (!session) return undefined;
  const cls = classOf(db, session.classId);
  if (!cls) return undefined;
  return computeSession(session, cls, studentsOf(db, cls.id), loadRows(db, [session.id]), content);
}

/**
 * The class register, as on paper: children down in alphabetical order, ended lessons across,
 * oldest first. The caller has checked access.
 */
export function classJournal(db: Db, content: ContentStore, classId: string): Journal | undefined {
  const cls = classOf(db, classId);
  if (!cls) return undefined;
  const sessions = db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.classId, classId), eq(schema.sessions.status, 'ended')))
    .orderBy(asc(schema.sessions.startedAt))
    .all();
  const students = studentsOf(db, classId);
  const rows = loadRows(
    db,
    sessions.map((s) => s.id),
  );
  const perSession = sessions.map((s) => computeSession(s, cls, students, rows, content));

  // Everyone on today's list, and anyone who has since left — or was virtual — but sat a lesson.
  const seen = new Set(perSession.flatMap((r) => r.rows.map((row) => row.studentId)));
  const listed = students
    .filter((s) => (s.isActive && !s.isVirtual) || seen.has(s.id))
    .sort(byStudentName);

  // The teacher's own columns (W9) and their grades.
  const manual = db
    .select()
    .from(schema.journalColumns)
    .where(and(eq(schema.journalColumns.classId, classId), isNull(schema.journalColumns.deletedAt)))
    .all();
  const manualGrades = manual.length
    ? db
        .select()
        .from(schema.grades)
        .where(
          inArray(
            schema.grades.columnId,
            manual.map((c) => c.id),
          ),
        )
        .all()
    : [];
  const comments = new Map(
    rows.grades.filter((g) => g.comment).map((g) => [`${g.sessionId}:${g.studentId}`, g.comment]),
  );

  const marks = new Map(
    db
      .select()
      .from(schema.emaktabMarks)
      .where(eq(schema.emaktabMarks.classId, classId))
      .all()
      .map((m) => [m.columnId, m.markedAt]),
  );

  type Column =
    | { kind: 'lesson'; date: string; at: string; result: SessionResults }
    | { kind: 'manual'; date: string; at: string; column: (typeof manual)[number] };
  const columns: Column[] = [
    ...perSession.map((r): Column => ({
      kind: 'lesson',
      date: r.date,
      at: r.startedAt,
      result: r,
    })),
    ...manual.map((c): Column => ({ kind: 'manual', date: c.date, at: c.createdAt, column: c })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));

  return {
    class: {
      id: cls.id,
      name: cls.name,
      starsToGrade: cls.settings.starsToGrade,
      thresholds: cls.settings.gradeThresholds ?? DEFAULT_GRADE_THRESHOLDS,
    },
    lessons: columns.map((c) =>
      c.kind === 'lesson'
        ? {
            kind: 'lesson' as const,
            sessionId: c.result.sessionId,
            columnId: null,
            lessonId: c.result.lessonId,
            lessonTitle: c.result.lessonTitle,
            date: c.date,
            emaktabAt: marks.get(c.result.sessionId) ?? null,
          }
        : {
            kind: 'manual' as const,
            sessionId: null,
            columnId: c.column.id,
            lessonId: null,
            lessonTitle: c.column.title,
            date: c.date,
            emaktabAt: marks.get(c.column.id) ?? null,
          },
    ),
    emaktab: true,
    students: listed.map((student) => ({
      id: student.id,
      name: fullName(student),
      isActive: student.isActive,
      isVirtual: student.isVirtual,
      cells: columns.map((c): JournalCell | null => {
        if (c.kind === 'manual') {
          // A column without a lesson is for everyone on the list: an empty cell waits for a grade.
          const g = manualGrades.find(
            (x) => x.columnId === c.column.id && x.studentId === student.id,
          );
          const value = g?.value != null ? GradeValueSchema.safeParse(g.value) : null;
          return {
            present: !g?.absent,
            stars: 0,
            grade: value?.success ? value.data : null,
            confirmed: true,
            comment: g?.comment ?? null,
          };
        }
        const row = c.result.rows.find((x) => x.studentId === student.id);
        return row
          ? {
              present: row.present,
              stars: row.totalStars,
              grade: row.grade,
              confirmed: row.gradeConfirmed,
              comment: comments.get(`${c.result.sessionId}:${student.id}`) ?? null,
            }
          : null;
      }),
    })),
  };
}

/**
 * The teacher confirms or changes grades of a finished lesson (H10). A value that equals the
 * suggestion is recorded as confirmed (`session`), any other as the teacher's own (`manual`); null
 * removes the row, and the suggestion shows again. Only a child who was at the lesson can be graded.
 * The lesson goes back into the queue for the platform, so the grades follow it there.
 */
export function setSessionGrades(
  db: Db,
  content: ContentStore,
  sessionId: string,
  input: SetGrades,
  now = new Date(),
): SessionResults | undefined {
  const results = sessionResults(db, content, sessionId);
  if (!results) return undefined;
  if (results.status !== 'ended') {
    throw new ApiHttpError(409, 'lesson_running', 'Grades are set when the lesson is over');
  }
  const rows = new Map(results.rows.map((r) => [r.studentId, r]));
  for (const g of input.grades) {
    if (!rows.get(g.studentId)?.present) {
      throw new ApiHttpError(400, 'not_at_lesson', 'This student was not at the lesson');
    }
  }
  const at = now.toISOString();
  db.transaction((tx) => {
    for (const g of input.grades) {
      const row = rows.get(g.studentId);
      if (!row) continue;
      const where = and(
        eq(schema.grades.sessionId, sessionId),
        eq(schema.grades.studentId, g.studentId),
      );
      if (g.value === null) {
        // A note stays without its grade (W9); a row with neither goes.
        const kept = tx
          .select({ comment: schema.grades.comment })
          .from(schema.grades)
          .where(where)
          .get();
        if (kept?.comment) tx.update(schema.grades).set({ value: null }).where(where).run();
        else tx.delete(schema.grades).where(where).run();
        continue;
      }
      const source = g.value === row.suggestedGrade ? 'session' : 'manual';
      tx.insert(schema.grades)
        .values({
          id: randomUUID(),
          studentId: g.studentId,
          classId: results.class.id,
          sessionId,
          date: results.date,
          stars: row.totalStars,
          value: g.value,
          source,
          createdAt: at,
        })
        .onConflictDoUpdate({
          target: [schema.grades.sessionId, schema.grades.studentId],
          set: { value: g.value, source, stars: row.totalStars, createdAt: at },
        })
        .run();
    }
    // What the platform holds for this lesson is now out of date: send the lesson again (ADR-011).
    tx.update(schema.sessions)
      .set({ syncedAt: null })
      .where(eq(schema.sessions.id, sessionId))
      .run();
  });
  return sessionResults(db, content, sessionId);
}
