import { eq } from 'drizzle-orm';
import {
  authoredQuiz,
  authoredToLesson,
  AuthoredLessonDocSchema,
  AssetExtensionSchema,
  isAuthoredLessonId,
  type Course,
  type Lesson,
  type PracticeTask,
  type Quiz,
} from '@sinf/shared';
import { schema, type Db } from '../db/index.js';
import { assetPath } from '../services/assets.js';
import type { ContentStore } from './index.js';

/**
 * The author's courses and the teachers' own lessons behind one `ContentStore` (stage 4, W1;
 * ADR-019): the engine, the results, the practice and the school computer ask for a lesson by id
 * and get the author's format either way.
 *
 * A teacher's lesson is read from the database on demand and kept while its version stands; a save
 * makes a new version, and the next read rebuilds it. A deleted lesson is still found by id: the
 * lessons held with it keep their results.
 */

export const OWN_COURSE_ID = 'own';

type Row = typeof schema.authoredLessons.$inferSelect;

interface Built {
  version: number;
  updatedAt: string;
  lesson: Lesson;
  quiz: Quiz | null;
  practice: PracticeTask | null;
}

/** A practice template of a teacher's lesson is a lesson file: `<sha>.<ext>`. */
const TEMPLATE_FILE = /^([0-9a-f]{64})\.([a-z]+)$/;

export function withAuthoredLessons(content: ContentStore, db: Db, dataDir: string): ContentStore {
  const cache = new Map<string, Built>();

  const build = (id: string): Built | undefined => {
    if (!isAuthoredLessonId(id)) return undefined;
    const row: Row | undefined = db
      .select()
      .from(schema.authoredLessons)
      .where(eq(schema.authoredLessons.id, id))
      .get();
    if (!row) {
      cache.delete(id);
      return undefined;
    }
    const cached = cache.get(id);
    if (cached && cached.version === row.version && cached.updatedAt === row.updatedAt) return cached;
    // The document was checked when it was saved; reading it again keeps the defaults filled in.
    const doc = AuthoredLessonDocSchema.parse(row.doc);
    const source = { id: row.id, title: row.title, topic: row.topic, doc };
    const built: Built = {
      version: row.version,
      updatedAt: row.updatedAt,
      lesson: authoredToLesson(source),
      quiz: authoredQuiz(source),
      practice: doc.practice,
    };
    cache.set(id, built);
    return built;
  };

  /** The author's first course lends its slide styles; a teacher's lesson has no pictures of its own. */
  const ownCourse = (lesson: Lesson): Course | undefined => {
    const base = content.courses[0];
    if (!base) return undefined;
    return {
      ...base,
      id: OWN_COURSE_ID,
      title: lesson.title,
      lessons: [
        {
          id: lesson.id,
          group: lesson.group,
          num: lesson.num,
          title: lesson.title,
          sub: lesson.sub,
          icon: lesson.icon,
          screens: lesson.screens.length,
        },
      ],
    };
  };

  return {
    courses: content.courses,
    getLesson: (id) => content.getLesson(id) ?? build(id)?.lesson,
    getCourseOf: (id) => {
      const own = content.getCourseOf(id);
      if (own) return own;
      const built = build(id);
      return built ? ownCourse(built.lesson) : undefined;
    },
    getQuiz: (id) => content.getQuiz(id) ?? build(id)?.quiz ?? undefined,
    getPractice: (id) => content.getPractice(id) ?? build(id)?.practice ?? undefined,
    templatePath: (id) => {
      const fromContent = content.templatePath(id);
      if (fromContent) return fromContent;
      const template = build(id)?.practice?.template;
      const match = template ? TEMPLATE_FILE.exec(template) : null;
      const ext = match ? AssetExtensionSchema.safeParse(match[2]) : null;
      return match?.[1] && ext?.success ? assetPath(dataDir, match[1], ext.data) : null;
    },
  };
}
