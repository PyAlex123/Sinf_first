import {
  CourseSchema,
  LessonSchema,
  PicsSchema,
  type Course,
  type Lesson,
  type Pics,
} from '@sinf/shared';

/**
 * Content loader for the standalone demo page: reads the lesson files published next to the page
 * (relative paths, no API, no server). The build script rewrites the absolute `/content/<course>/`
 * URLs of the import into relative ones.
 */

export interface DemoBundle {
  course: Course;
  lesson: Lesson;
  pics: Pics;
}

/** `/content/<course>/media/x.webp` → `content/media/x.webp`, relative to the published page. */
function relative(text: string, courseId: string): string {
  return text.split(`/content/${courseId}/`).join('content/');
}

let coursePromise: Promise<Course> | null = null;
let picsPromise: Promise<Pics> | null = null;
const lessons = new Map<string, Promise<Lesson>>();
let stylesLoaded = false;

async function readJson(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Не удалось загрузить ${path}: ${res.status}`);
  return (await res.json()) as unknown;
}

export async function loadCourse(): Promise<Course> {
  coursePromise ??= readJson('content/course.json').then((data) => {
    const course = CourseSchema.parse(data);
    return {
      ...course,
      styles: relative(course.styles, course.id),
      pics: relative(course.pics, course.id),
    };
  });
  return coursePromise;
}

async function loadPics(course: Course): Promise<Pics> {
  picsPromise ??= readJson(course.pics).then((data) => PicsSchema.parse(data));
  return picsPromise;
}

function ensureStyles(course: Course): void {
  if (stylesLoaded) return;
  stylesLoaded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = course.styles;
  document.head.appendChild(link);
}

export async function loadBundle(lessonId: string): Promise<DemoBundle> {
  const course = await loadCourse();
  ensureStyles(course);
  let lesson = lessons.get(lessonId);
  if (!lesson) {
    lesson = readJson(`content/lessons/${lessonId}.json`).then((data) => LessonSchema.parse(data));
    lessons.set(lessonId, lesson);
  }
  const [loadedLesson, pics] = await Promise.all([lesson, loadPics(course)]);
  return {
    course,
    pics,
    lesson: {
      ...loadedLesson,
      media: loadedLesson.media.map((url) => relative(url, course.id)),
      screens: loadedLesson.screens.map((screen) =>
        'html' in screen ? { ...screen, html: relative(screen.html, course.id) } : screen,
      ),
    },
  };
}
