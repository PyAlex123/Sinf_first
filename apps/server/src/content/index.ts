import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CourseSchema, LessonSchema, type Course, type Lesson } from '@sinf/shared';

/**
 * Imported lesson content (ADR-005) loaded into memory at startup: `content/<course>/course.json` and
 * `lessons/<id>.json`. Files are validated with the shared schemas, so a broken import fails fast.
 */
export interface ContentStore {
  readonly courses: readonly Course[];
  getLesson(id: string): Lesson | undefined;
  /** Course a lesson belongs to. */
  getCourseOf(lessonId: string): Course | undefined;
}

export function loadContent(contentDir: string): ContentStore {
  if (!existsSync(contentDir)) {
    throw new Error(`Content folder not found: ${contentDir}`);
  }
  const courses: Course[] = [];
  const lessons = new Map<string, Lesson>();
  const courseOf = new Map<string, Course>();
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
    }
    courses.push(course);
  }
  courses.sort((a, b) => a.id.localeCompare(b.id));
  return {
    courses,
    getLesson: (id) => lessons.get(id),
    getCourseOf: (id) => courseOf.get(id),
  };
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}
