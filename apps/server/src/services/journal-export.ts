import { registerDate, type Journal, type Locale } from '@sinf/shared';
import { buildXlsx, type Cell } from './xlsx.js';

/**
 * The class journal as an Excel file (S1.13): children in alphabetical order, one column per
 * lesson, and in a cell the stars of that lesson — or the 2–5 grade, when the class turns stars
 * into grades — or the absence mark. The layout follows a paper register, so copying into
 * eMaktab goes row by row (CLAUDE.md §4.10).
 *
 * The file is made on the server, so its words live here rather than in the web dictionaries;
 * there are only a few of them, in both interface languages (CLAUDE.md §3.5).
 */

interface Labels {
  sheet: string;
  number: string;
  student: string;
  topic: string;
  absent: string;
  left: string;
  virtual: string;
  legendStars: string;
  legendGrades: string;
  file: string;
}

const LABELS: Record<Locale, Labels> = {
  ru: {
    sheet: 'Журнал',
    number: '№',
    student: 'Ученик',
    topic: 'Тема урока',
    absent: 'н',
    left: 'выбыл',
    virtual: 'виртуальный',
    legendStars: 'В клетке — звёзды за урок; «н» — не был на уроке.',
    legendGrades: 'В клетке — оценка 2–5 по звёздам урока; «н» — не был на уроке.',
    file: 'zhurnal',
  },
  uz: {
    sheet: 'Jurnal',
    number: '№',
    student: 'O‘quvchi',
    topic: 'Dars mavzusi',
    absent: 'yo‘q',
    left: 'chiqib ketgan',
    virtual: 'virtual',
    legendStars: 'Katakda — darsdagi yulduzchalar; «yo‘q» — darsda bo‘lmagan.',
    legendGrades: 'Katakda — dars yulduzchalari bo‘yicha 2–5 baho; «yo‘q» — darsda bo‘lmagan.',
    file: 'jurnal',
  },
  en: {
    sheet: 'Gradebook',
    number: 'No.',
    student: 'Student',
    topic: 'Lesson topic',
    absent: 'abs.',
    left: 'left',
    virtual: 'virtual',
    legendStars: 'A cell holds the stars of the lesson; “abs.” — not at the lesson.',
    legendGrades: 'A cell holds the 2–5 grade by the lesson’s stars; “abs.” — not at the lesson.',
    file: 'gradebook',
  },
};

export function journalFileName(journal: Journal, locale: Locale): string {
  return `${LABELS[locale].file}-${journal.class.name}.xlsx`;
}

/** Rows of the sheet, apart from the file itself — easy to check in a test. */
export function journalRows(journal: Journal, locale: Locale): Cell[][] {
  const l = LABELS[locale];
  const header: Cell[] = [
    { value: l.number, style: 'bold' },
    { value: l.student, style: 'bold' },
    ...journal.lessons.map((lesson) => ({
      value: registerDate(lesson.date),
      style: 'boldCenter' as const,
    })),
  ];
  const topics: Cell[] = [
    null,
    { value: l.topic, style: 'muted' },
    ...journal.lessons.map((lesson) => ({ value: lesson.lessonTitle, style: 'muted' as const })),
  ];
  const students: Cell[][] = journal.students.map((student, i) => [
    i + 1,
    student.isVirtual
      ? `${student.name} (${l.virtual})`
      : student.isActive
        ? student.name
        : `${student.name} (${l.left})`,
    ...student.cells.map((cell): Cell => {
      if (!cell) return null;
      if (!cell.present) return { value: l.absent, style: 'center' };
      return { value: cell.grade ?? cell.stars, style: 'center' };
    }),
  ]);
  return [
    header,
    topics,
    ...students,
    [],
    [null, journal.class.starsToGrade ? l.legendGrades : l.legendStars],
  ];
}

export function journalXlsx(journal: Journal, locale: Locale): Uint8Array {
  return buildXlsx({
    name: `${LABELS[locale].sheet} ${journal.class.name}`,
    rows: journalRows(journal, locale),
    widths: [5, 30, ...journal.lessons.map(() => 14)],
    freeze: { rows: 2, cols: 2 },
  });
}
