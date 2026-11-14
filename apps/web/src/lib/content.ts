import type { Course, Lesson, Pics } from '@sinf/shared';
import { api } from './api.js';

/**
 * Lesson content for the player: course index, lesson JSON and the trainer pictures, cached per page load.
 * The author's stylesheet is attached once per course, scoped under `.lesson-root` by the import.
 */

export interface LessonBundle {
  course: Course;
  lesson: Lesson;
  pics: Pics;
}

let coursesPromise: Promise<Course[]> | null = null;
const picsByUrl = new Map<string, Promise<Pics>>();
const lessons = new Map<string, Promise<Lesson>>();
const styles = new Set<string>();

export async function loadCourses(): Promise<Course[]> {
  coursesPromise ??= api.courses().then((r) => r.courses);
  return coursesPromise;
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
  const course = courses.find((c) => c.lessons.some((l) => l.id === lessonId));
  if (!course) throw new Error(`Lesson "${lessonId}" is not in any course`);
  let pics = picsByUrl.get(course.pics);
  if (!pics) {
    pics = api.pics(course.pics);
    picsByUrl.set(course.pics, pics);
  }
  ensureStylesheet(course.styles);
  const [lesson, loadedPics] = await Promise.all([loadLesson(lessonId), pics]);
  return { course, lesson, pics: loadedPics };
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
