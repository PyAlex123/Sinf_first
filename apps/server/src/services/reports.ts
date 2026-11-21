import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  averageOf,
  countGrade,
  emptyGradeCounts,
  ktpPlanned,
  type ClassReport,
  type ClassReportStudent,
  type GradeCounts,
  type KtpProgress,
  type Locale,
  type ReportRow,
  type SchoolReport,
} from '@sinf/shared';
import type { ContentStore } from '../content/index.js';
import { schema, type Db } from '../db/index.js';
import { classJournal } from './results.js';
import { buildXlsx, type Cell } from './xlsx.js';

/**
 * Reports (PLAN.md 8.2; stage 6, B1): a period of a class, of a school's classes and parallels,
 * counted from the class journal (W9) — the same cells the teacher sees — and the class's KTPs.
 */

interface Tally {
  row: ReportRow;
  /** Children at lessons, and children on the list at those lessons: attendance is their ratio. */
  present: number;
  expected: number;
}

const inPeriod = (date: string, from: string, to: string): boolean => date >= from && date <= to;

function ktpOf(db: Db, classId: string, to: string): KtpProgress | null {
  const plans = db
    .select({ id: schema.ktpPlans.id })
    .from(schema.ktpPlans)
    .where(eq(schema.ktpPlans.classId, classId))
    .all();
  if (plans.length === 0) return null;
  const end = new Date(`${to}T12:00:00.000Z`);
  let rows = 0;
  let done = 0;
  let planned: number | null = null;
  for (const plan of plans) {
    const topics = db
      .select()
      .from(schema.ktpRows)
      .where(and(eq(schema.ktpRows.planId, plan.id), isNull(schema.ktpRows.deletedAt)))
      .orderBy(asc(schema.ktpRows.position))
      .all();
    rows += topics.length;
    done += topics.filter((t) => t.isDone).length;
    const due = ktpPlanned(topics, end);
    if (due !== null) planned = (planned ?? 0) + due;
  }
  return { rows, done, planned };
}

/** One class over the period: its summary and each child. */
function tallyClass(
  db: Db,
  content: ContentStore,
  cls: { id: string; name: string; grade: number },
  from: string,
  to: string,
): { tally: Tally; students: ClassReportStudent[] } | null {
  const journal = classJournal(db, content, cls.id);
  if (!journal) return null;
  const columns = journal.lessons
    .map((lesson, index) => ({ lesson, index }))
    .filter((c) => inPeriod(c.lesson.date, from, to));
  const lessonColumns = columns.filter((c) => c.lesson.kind === 'lesson');
  // The children of the class today: one who left or a virtual one is not the class's number.
  const children = journal.students.filter((s) => s.isActive && !s.isVirtual);
  const classGrades = emptyGradeCounts();
  let present = 0;
  let expected = 0;
  const students = children.map((child): ClassReportStudent => {
    const grades = emptyGradeCounts();
    let came = 0;
    let lessons = 0;
    for (const { index } of lessonColumns) {
      const cell = child.cells[index];
      if (!cell) continue;
      lessons += 1;
      if (cell.present) came += 1;
    }
    for (const { index } of columns) {
      const cell = child.cells[index];
      if (cell?.present && cell.grade !== null && cell.confirmed) {
        countGrade(grades, cell.grade);
        countGrade(classGrades, cell.grade);
      }
    }
    present += came;
    expected += lessons;
    return {
      id: child.id,
      name: child.name,
      present: came,
      lessons,
      grades,
      average: averageOf(grades),
    };
  });
  return {
    tally: {
      row: {
        classId: cls.id,
        name: cls.name,
        grade: cls.grade,
        students: children.length,
        lessons: lessonColumns.length,
        attendance: expected > 0 ? Math.round((present * 1000) / expected) / 10 : null,
        grades: classGrades,
        average: averageOf(classGrades),
        ktp: ktpOf(db, cls.id, to),
      },
      present,
      expected,
    },
    students,
  };
}

export function classReport(
  db: Db,
  content: ContentStore,
  classId: string,
  from: string,
  to: string,
): ClassReport | null {
  const cls = db.select().from(schema.classes).where(eq(schema.classes.id, classId)).get();
  if (!cls) return null;
  const done = tallyClass(db, content, cls, from, to);
  if (!done) return null;
  return { from, to, summary: done.tally.row, students: done.students };
}

function addCounts(a: GradeCounts, b: GradeCounts): GradeCounts {
  return {
    five: a.five + b.five,
    four: a.four + b.four,
    three: a.three + b.three,
    two: a.two + b.two,
  };
}

export function schoolReport(
  db: Db,
  content: ContentStore,
  school: { id: string; name: string },
  from: string,
  to: string,
): SchoolReport {
  const classes = db
    .select()
    .from(schema.classes)
    .where(eq(schema.classes.schoolId, school.id))
    .orderBy(asc(schema.classes.grade), asc(schema.classes.name))
    .all();
  const tallies = classes.flatMap((c) => tallyClass(db, content, c, from, to)?.tally ?? []);
  const byGrade = new Map<number, Tally[]>();
  for (const t of tallies) byGrade.set(t.row.grade, [...(byGrade.get(t.row.grade) ?? []), t]);
  const parallels = [...byGrade.entries()]
    .sort(([a], [b]) => a - b)
    .map(([grade, list]): ReportRow => {
      const present = list.reduce((n, t) => n + t.present, 0);
      const expected = list.reduce((n, t) => n + t.expected, 0);
      const grades = list.reduce((g, t) => addCounts(g, t.row.grades), emptyGradeCounts());
      const ktps = list.flatMap((t) => (t.row.ktp ? [t.row.ktp] : []));
      return {
        classId: null,
        name: String(grade),
        grade,
        students: list.reduce((n, t) => n + t.row.students, 0),
        lessons: list.reduce((n, t) => n + t.row.lessons, 0),
        attendance: expected > 0 ? Math.round((present * 1000) / expected) / 10 : null,
        grades,
        average: averageOf(grades),
        ktp:
          ktps.length === 0
            ? null
            : {
                rows: ktps.reduce((n, k) => n + k.rows, 0),
                done: ktps.reduce((n, k) => n + k.done, 0),
                planned: ktps.some((k) => k.planned !== null)
                  ? ktps.reduce((n, k) => n + (k.planned ?? 0), 0)
                  : null,
              },
      };
    });
  return { school, from, to, classes: tallies.map((t) => t.row), parallels };
}

// ---------- Excel

interface Labels {
  school: string;
  cls: string;
  parallel: string;
  student: string;
  students: string;
  lessons: string;
  attendance: string;
  present: string;
  average: string;
  ktpDone: string;
  ktpPlanned: string;
  ktpRows: string;
  period: string;
}

const LABELS: Record<Locale, Labels> = {
  ru: {
    school: 'Отчёт школы',
    cls: 'Класс',
    parallel: 'Параллель',
    student: 'Ученик',
    students: 'Учеников',
    lessons: 'Уроков',
    attendance: 'Посещаемость, %',
    present: 'Был на уроках',
    average: 'Средний балл',
    ktpDone: 'КТП: проведено',
    ktpPlanned: 'КТП: по плану',
    ktpRows: 'КТП: всего тем',
    period: 'Период',
  },
  uz: {
    school: 'Maktab hisoboti',
    cls: 'Sinf',
    parallel: 'Parallel',
    student: 'O‘quvchi',
    students: 'O‘quvchilar',
    lessons: 'Darslar',
    attendance: 'Davomat, %',
    present: 'Darsda bo‘lgan',
    average: 'O‘rtacha baho',
    ktpDone: 'KTR: o‘tilgan',
    ktpPlanned: 'KTR: reja bo‘yicha',
    ktpRows: 'KTR: jami mavzu',
    period: 'Davr',
  },
  en: {
    school: 'School report',
    cls: 'Class',
    parallel: 'Grade year',
    student: 'Student',
    students: 'Students',
    lessons: 'Lessons',
    attendance: 'Attendance, %',
    present: 'At lessons',
    average: 'Average grade',
    ktpDone: 'Plan: done',
    ktpPlanned: 'Plan: due',
    ktpRows: 'Plan: topics',
    period: 'Period',
  },
};

const bold = (value: string): Cell => ({ value, style: 'boldCenter' });

function rowCells(r: ReportRow, name: string): Cell[] {
  return [
    name,
    r.students,
    r.lessons,
    r.attendance,
    r.average,
    r.grades.five,
    r.grades.four,
    r.grades.three,
    r.grades.two,
    r.ktp?.done ?? null,
    r.ktp?.planned ?? null,
    r.ktp?.rows ?? null,
  ];
}

export function schoolReportXlsx(report: SchoolReport, locale: Locale): Uint8Array {
  const l = LABELS[locale];
  const head = [
    l.cls,
    l.students,
    l.lessons,
    l.attendance,
    l.average,
    '5',
    '4',
    '3',
    '2',
    l.ktpDone,
    l.ktpPlanned,
    l.ktpRows,
  ];
  return buildXlsx({
    name: l.school,
    rows: [
      [{ value: `${l.school}: ${report.school.name}`, style: 'bold' }],
      [`${l.period}: ${report.from} — ${report.to}`],
      head.map(bold),
      ...report.classes.map((r) => rowCells(r, r.name)),
      [],
      [l.parallel, ...head.slice(1)].map(bold),
      ...report.parallels.map((r) => rowCells(r, r.name)),
    ],
    widths: [14, 10, 8, 14, 12, 5, 5, 5, 5, 14, 13, 13],
    freeze: { rows: 3, cols: 1 },
  });
}

export function classReportXlsx(report: ClassReport, locale: Locale): Uint8Array {
  const l = LABELS[locale];
  const s = report.summary;
  return buildXlsx({
    name: s.name,
    rows: [
      [{ value: `${l.cls} ${s.name}`, style: 'bold' }],
      [`${l.period}: ${report.from} — ${report.to}`],
      [l.student, l.present, l.lessons, l.average, '5', '4', '3', '2'].map(bold),
      ...report.students.map((st): Cell[] => [
        st.name,
        st.present,
        st.lessons,
        st.average,
        st.grades.five,
        st.grades.four,
        st.grades.three,
        st.grades.two,
      ]),
      [],
      [
        l.cls,
        l.students,
        l.lessons,
        l.attendance,
        l.average,
        '5',
        '4',
        '3',
        '2',
        l.ktpDone,
        l.ktpPlanned,
        l.ktpRows,
      ].map(bold),
      rowCells(s, s.name),
    ],
    widths: [28, 14, 8, 12, 5, 5, 5, 5, 14, 13, 13],
    freeze: { rows: 3, cols: 1 },
  });
}
