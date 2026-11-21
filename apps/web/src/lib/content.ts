import type { Course, Lesson, Pics, PracticeTask, Quiz } from '@sinf/shared';
import { api } from './api.js';

/**
 * Lesson content for the player: course index, lesson JSON and the trainer pictures, cached per page load.
 * The author's stylesheet is attached once per course, scoped under `.lesson-root` by the import.
 */

export interface LessonBundle {
  course: Course;
  lesson: Lesson;
  pics: Pics;
  /** The live quiz of this lesson (S1.12); most lessons have none. */
  quiz: Quiz | null;
  /** The practice task in a real program (H16); most lessons have none. */
  practice: PracticeTask | null;
}

let coursesPromise: Promise<Course[]> | null = null;
const picsByUrl = new Map<string, Promise<Pics>>();
const lessons = new Map<string, Promise<Lesson>>();
const quizzes = new Map<string, Promise<Quiz | null>>();
const practices = new Map<string, Promise<PracticeTask | null>>();
const styles = new Set<string>();

export async function loadCourses(): Promise<Course[]> {
  coursesPromise ??= api.courses().then((r) => r.courses);
  return coursesPromise;
}

/** A teacher's lesson changes in the constructor: the next load must not come from this page's cache. */
export function forgetLesson(id: string): void {
  lessons.delete(id);
  quizzes.delete(id);
  practices.delete(id);
}

export async function loadLesson(id: string): Promise<Lesson> {
  let pending = lessons.get(id);
  if (!pending) {
    pending = api.lesson(id);
    lessons.set(id, pending);
  }
  return pending;
}

export async function loadLessonBundle(lessonId: string): Promise<LessonBundle> {
  const courses = await loadCourses();
  // A teacher's own lesson is in no course of the list: the server makes one for it (ADR-019).
  const course =
    courses.find((c) => c.lessons.some((l) => l.id === lessonId)) ??
    (await api.lessonCourse(lessonId));
  let pics = picsByUrl.get(course.pics);
  if (!pics) {
    pics = api.pics(course.pics);
    picsByUrl.set(course.pics, pics);
  }
  ensureStylesheet(course.styles);
  const [lesson, loadedPics, quiz, practice] = await Promise.all([
    loadLesson(lessonId),
    pics,
    loadQuiz(lessonId),
    loadPractice(lessonId),
  ]);
  return { course, lesson, pics: loadedPics, quiz, practice };
}

export async function loadPractice(lessonId: string): Promise<PracticeTask | null> {
  let pending = practices.get(lessonId);
  if (!pending) {
    pending = api.practice(lessonId).then((r) => r.practice);
    practices.set(lessonId, pending);
  }
  return pending;
}

/** The lesson's quiz, or null — most lessons have none, and the server says so plainly. */
export async function loadQuiz(lessonId: string): Promise<Quiz | null> {
  let pending = quizzes.get(lessonId);
  if (!pending) {
    pending = api.quiz(lessonId).then((r) => r.quiz);
    quizzes.set(lessonId, pending);
  }
  return pending;
}

/** Trainer pictures of the first course (used for picture codes on cards and the class list). */
export async function loadPics(): Promise<Pics> {
  const courses = await loadCourses();
  const course = courses[0];
  if (!course) return {};
  let pics = picsByUrl.get(course.pics);
  if (!pics) {
    pics = api.pics(course.pics);
    picsByUrl.set(course.pics, pics);
  }
  return pics;
}

export function ensureStylesheet(href: string): void {
  if (styles.has(href)) return;
  styles.add(href);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

/** Media URLs used by a screen's HTML (for preloading the next screen). */
export function mediaUrls(html: string): string[] {
  return html.match(/\/content\/[a-z0-9-]+\/media\/[0-9a-f]+\.webp/g) ?? [];
}

const preloaded = new Set<string>();
export function preload(urls: string[]): void {
  for (const url of urls) {
    if (preloaded.has(url)) continue;
    preloaded.add(url);
    const img = new Image();
    img.src = url;
  }
}
