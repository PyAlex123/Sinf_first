import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { checkFile } from '@sinf/checkers';
import {
  checkState,
  fileNameKey,
  isPracticeFile,
  type PracticeMarks,
  type SetPracticeMarks,
} from '@sinf/shared';
import type { ContentStore } from '../content/index.js';
import { schema, type Db } from '../db/index.js';
import { ApiHttpError } from '../errors.js';
import type { SessionStore } from '../realtime/session-store.js';
import { blobPath, collect, storeUpload } from './student-files.js';

/**
 * The practice of a lesson in a real program (CLAUDE.md §4.7–4.8; stage 3, H16; ADR-016, addendum).
 *
 * - When a child logs into a lesson with a practice task, the task's template goes into their
 *   "Мои работы" — unless a file of that name is there already: then it is their work and stays.
 *   The classroom app brings it into the working folder and opens it in the program (H15); in a
 *   browser the child downloads it from the folder.
 * - Every save of a file of the practice's kind, from the classroom app or a browser lesson, is
 *   checked here, on the lesson server: one place for both, and nothing a child's computer could
 *   change. The tile and the child's check-list follow through the lesson's state.
 * - With the photographs before the end of the practice, at its end and at the lesson's end the
 *   version checked last is handed in (§4.8): a change afterwards no longer alters the grade. A save
 *   that comes within a short while after the end still counts — the program asked "save?" when
 *   the practice closed it.
 */

/** How long after the practice's end a save still counts as handed in. */
export const HAND_IN_GRACE_MS = 30_000;
/** Where a template in a child's folder came from, as the folder shows it. */
const TEMPLATE_ORIGIN = 'задание';

export class PracticeService {
  /** Per child and lesson: checks run one after another, the newest save last. */
  private readonly queue = new Map<string, Promise<void>>();
  /** Lessons whose practice ended a moment ago: a late save is still handed in. */
  private readonly grace = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly content: ContentStore,
    private readonly store: SessionStore,
    private readonly dataDir: string,
    private readonly log: FastifyBaseLogger,
    private readonly trackChanges: () => boolean,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private lessonOf(sessionId: string): string | undefined {
    return (
      this.store.getState(sessionId)?.lessonId ??
      this.db
        .select({ lessonId: schema.sessions.lessonId })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .get()?.lessonId
    );
  }

  /** The template into the child's folder at login; a file already there is the child's and stays. */
  async placeTemplate(sessionId: string, studentId: string): Promise<void> {
    const lessonId = this.lessonOf(sessionId);
    if (!lessonId) return;
    const task = this.content.getPractice(lessonId);
    const path = this.content.templatePath(lessonId);
    if (!task || !path) return;
    const there = this.db
      .select({ id: schema.studentFiles.id })
      .from(schema.studentFiles)
      .where(
        and(
          eq(schema.studentFiles.studentId, studentId),
          eq(schema.studentFiles.nameKey, fileNameKey(task.fileName)),
          isNull(schema.studentFiles.deletedAt),
        ),
      )
      .get();
    if (there) return;
    const bytes = await readFile(path);
    await storeUpload(this.db, this.dataDir, {
      studentId,
      rawName: task.fileName,
      baseSha: null,
      origin: TEMPLATE_ORIGIN,
      body: Readable.from([bytes]),
      declaredSize: bytes.length,
      trackChanges: this.trackChanges(),
    });
    this.log.info({ sessionId, studentId, file: task.fileName }, 'practice template placed');
  }

  /**
   * A child saved a file during (or right after) a lesson. Checked when it is the practice's kind;
   * waits for the check, so a test or a browser that awaits the upload sees the score.
   */
  fileSaved(
    sessionId: string,
    studentId: string,
    file: { name: string; sha256: string | null },
  ): Promise<void> {
    const sha = file.sha256;
    if (!sha) return Promise.resolve();
    const lessonId = this.lessonOf(sessionId);
    const task = lessonId ? this.content.getPractice(lessonId) : undefined;
    if (!task || !isPracticeFile(task, file.name)) return Promise.resolve();
    const key = `${sessionId}:${studentId}`;
    const next = (this.queue.get(key) ?? Promise.resolve())
      .then(() => this.check(sessionId, studentId, file.name, sha))
      .catch((error: unknown) => {
        this.log.error({ err: error, sessionId, studentId }, 'practice check failed');
      });
    this.queue.set(key, next);
    void next.then(() => {
      if (this.queue.get(key) === next) this.queue.delete(key);
    });
    return next;
  }

  private async check(
    sessionId: string,
    studentId: string,
    name: string,
    sha: string,
  ): Promise<void> {
    const lessonId = this.lessonOf(sessionId);
    const task = lessonId ? this.content.getPractice(lessonId) : undefined;
    if (!task) return;
    const live = this.store.getState(sessionId)?.status === 'active';
    const late = (this.grace.get(sessionId) ?? 0) >= this.now();
    if (!live && !late) return;

    const bytes = await readFile(blobPath(this.dataDir, sha));
    const report = checkFile(new Uint8Array(bytes), name, task.criteria);
    const at = new Date(this.now()).toISOString();
    const handIn = late
      ? { submittedName: name, submittedSha: sha, submittedReport: report, submittedAt: at }
      : {};
    const before = this.db
      .select()
      .from(schema.practiceChecks)
      .where(
        and(
          eq(schema.practiceChecks.sessionId, sessionId),
          eq(schema.practiceChecks.studentId, studentId),
        ),
      )
      .get();
    this.db.transaction((tx) => {
      tx.insert(schema.practiceChecks)
        .values({
          sessionId,
          studentId,
          fileName: name,
          fileSha: sha,
          report,
          checkedAt: at,
          ...handIn,
        })
        .onConflictDoUpdate({
          target: [schema.practiceChecks.sessionId, schema.practiceChecks.studentId],
          set: { fileName: name, fileSha: sha, report, checkedAt: at, ...handIn },
        })
        .run();
      if (!live) {
        // The lesson went to the platform already: what was handed in changed, send it again.
        tx.update(schema.sessions)
          .set({ syncedAt: null })
          .where(eq(schema.sessions.id, sessionId))
          .run();
      }
    });
    // The version checked before is no longer named by this row (unless handed in).
    if (before && before.fileSha !== sha) collect(this.db, this.dataDir, before.fileSha);
    if (before?.submittedSha && handIn.submittedSha && before.submittedSha !== sha) {
      collect(this.db, this.dataDir, before.submittedSha);
    }
    this.store.practiceChecked(sessionId, studentId, checkState(task, name, report, this.now()));
    this.log.info(
      {
        sessionId,
        studentId,
        score: report.autoScore,
        max: report.autoMax,
        ms: Math.round(report.ms),
      },
      'practice file checked',
    );
  }

  /**
   * The works are handed in: every child's latest checked version becomes the one that is graded.
   * Before the end — a first copy; at the end — the final one; at the lesson's end — only for
   * those who had none (a lesson ended without leaving the practice).
   */
  handIn(sessionId: string, reason: 'before_end' | 'stage_end' | 'session_end'): void {
    const lessonId = this.lessonOf(sessionId);
    if (!lessonId || !this.content.getPractice(lessonId)) return;
    if (reason !== 'before_end') this.grace.set(sessionId, this.now() + HAND_IN_GRACE_MS);
    for (const [key, until] of this.grace) {
      if (until < this.now()) this.grace.delete(key);
    }
    const at = new Date(this.now()).toISOString();
    const rows = this.db
      .select()
      .from(schema.practiceChecks)
      .where(eq(schema.practiceChecks.sessionId, sessionId))
      .all();
    const freed: string[] = [];
    this.db.transaction((tx) => {
      for (const row of rows) {
        if (!row.fileSha) continue;
        if (reason === 'session_end' && row.submittedSha) continue;
        if (row.submittedSha && row.submittedSha !== row.fileSha) freed.push(row.submittedSha);
        tx.update(schema.practiceChecks)
          .set({
            submittedName: row.fileName,
            submittedSha: row.fileSha,
            submittedReport: row.report,
            submittedAt: at,
          })
          .where(
            and(
              eq(schema.practiceChecks.sessionId, sessionId),
              eq(schema.practiceChecks.studentId, row.studentId),
            ),
          )
          .run();
      }
    });
    for (const sha of freed) collect(this.db, this.dataDir, sha);
    if (rows.length > 0)
      this.log.info({ sessionId, reason, works: rows.length }, 'works handed in');
  }

  /**
   * The teacher's marks (CLAUDE.md §4.7 "ручные критерии"), during the lesson or after it: a manual
   * criterion met or not, an automatic one the checker could not decide. A child who saved nothing
   * gets a row too — a drawing on paper can still be marked.
   */
  setMarks(sessionId: string, input: SetPracticeMarks): void {
    const lessonId = this.lessonOf(sessionId);
    const task = lessonId ? this.content.getPractice(lessonId) : undefined;
    if (!task) throw new ApiHttpError(400, 'no_practice', 'This lesson has no practice task');
    const ids = new Set(task.criteria.map((c) => c.id));
    for (const id of Object.keys(input.marks)) {
      if (!ids.has(id)) throw new ApiHttpError(400, 'bad_criterion', `No criterion "${id}"`);
    }
    const present = this.db
      .select({ status: schema.attendance.status })
      .from(schema.attendance)
      .where(
        and(
          eq(schema.attendance.sessionId, sessionId),
          eq(schema.attendance.studentId, input.studentId),
        ),
      )
      .get();
    if (present?.status !== 'present') {
      throw new ApiHttpError(400, 'not_at_lesson', 'This student was not at the lesson');
    }
    const where = and(
      eq(schema.practiceChecks.sessionId, sessionId),
      eq(schema.practiceChecks.studentId, input.studentId),
    );
    this.db.transaction((tx) => {
      const row = tx.select().from(schema.practiceChecks).where(where).get();
      const marks: PracticeMarks = { ...(row?.marks ?? {}) };
      for (const [id, value] of Object.entries(input.marks)) {
        if (value === null) delete marks[id];
        else marks[id] = value;
      }
      if (row) {
        tx.update(schema.practiceChecks).set({ marks }).where(where).run();
      } else {
        tx.insert(schema.practiceChecks)
          .values({ sessionId, studentId: input.studentId, marks })
          .run();
      }
      tx.update(schema.sessions)
        .set({ syncedAt: null })
        .where(eq(schema.sessions.id, sessionId))
        .run();
    });
  }
}
