import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import {
  CourseSchema,
  isPracticeFile,
  LessonSchema,
  PracticeTaskSchema,
  QuizSchema,
  type Course,
  type Lesson,
  type PracticeTask,
  type Quiz,
} from '@sinf/shared';

/**
 * Imported lesson content (ADR-005) loaded into memory at startup: `content/<course>/course.json` and
 * `lessons/<id>.json`. Files are validated with the shared schemas, so a broken import fails fast.
 */
export interface ContentStore {
  readonly courses: readonly Course[];
  getLesson(id: string): Lesson | undefined;
  /** Course a lesson belongs to. */
  getCourseOf(lessonId: string): Course | undefined;
  /**
   * The live quiz of a lesson (S1.12), from `quizzes/<id>.json`. Written by hand, not by the import,
   * and most lessons have none — a missing file is the normal case, not an error.
   */
  getQuiz(lessonId: string): Quiz | undefined;
  /**
   * The practice task in a real program (H16), from `practice/<id>.json`; written by hand like the
   * quiz, and most lessons have none.
   */
  getPractice(lessonId: string): PracticeTask | undefined;
  /** Where the task's template lies on disk, checked at startup; null when the task has none. */
  templatePath(lessonId: string): string | null;
}

export function loadContent(contentDir: string): ContentStore {
  if (!existsSync(contentDir)) {
    throw new Error(`Content folder not found: ${contentDir}`);
  }
  const courses: Course[] = [];
  const lessons = new Map<string, Lesson>();
  const courseOf = new Map<string, Course>();
  const quizzes = new Map<string, Quiz>();
  const practices = new Map<string, PracticeTask>();
  const templates = new Map<string, string>();
  for (const entry of readdirSync(contentDir, { withFileTypes: true })) {
    const courseFile = join(contentDir, entry.name, 'course.json');
    if (!entry.isDirectory() || !existsSync(courseFile)) {
      continue;
    }
    const course = CourseSchema.parse(readJson(courseFile));
    if (course.id !== entry.name) {
      throw new Error(`${courseFile}: course id "${course.id}" differs from folder name`);
    }
    for (const summary of course.lessons) {
      const lesson = LessonSchema.parse(readJson(join(contentDir, entry.name, 'lessons', `${summary.id}.json`)));
      if (lessons.has(lesson.id)) {
        throw new Error(`Lesson id "${lesson.id}" is used by more than one course`);
      }
      lessons.set(lesson.id, lesson);
      courseOf.set(lesson.id, course);
      const quizFile = join(contentDir, entry.name, 'quizzes', `${summary.id}.json`);
      if (existsSync(quizFile)) {
        const quiz = QuizSchema.parse(readJson(quizFile));
        if (quiz.lessonId !== lesson.id) {
          throw new Error(`${quizFile}: quiz belongs to lesson "${quiz.lessonId}"`);
        }
        quizzes.set(lesson.id, quiz);
      }
      const practiceFile = join(contentDir, entry.name, 'practice', `${summary.id}.json`);
      if (existsSync(practiceFile)) {
        const task = PracticeTaskSchema.parse(readJson(practiceFile));
        if (!isPracticeFile(task, task.fileName)) {
          throw new Error(`${practiceFile}: "${task.fileName}" is not a file of ${task.app}`);
        }
        practices.set(lesson.id, task);
        if (task.template) {
          const courseDir = join(contentDir, entry.name);
          const path = normalize(join(courseDir, task.template));
          // A template is a file of its own course: never a path out of it.
          if (!path.startsWith(courseDir + sep) || !existsSync(path)) {
            throw new Error(`${practiceFile}: template "${task.template}" is not in the course`);
          }
          templates.set(lesson.id, path);
        }
      }
    }
    courses.push(course);
  }
  courses.sort((a, b) => a.id.localeCompare(b.id));
  return {
    courses,
    getLesson: (id) => lessons.get(id),
    getCourseOf: (id) => courseOf.get(id),
    getQuiz: (id) => quizzes.get(id),
    getPractice: (id) => practices.get(id),
    templatePath: (id) => templates.get(id) ?? null,
  };
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}
