import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, inArray, isNull, lt, or, isNotNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { RetentionPreview } from '@sinf/shared';
import { schema, type Db } from '../db/index.js';
import { settingsOfSchool } from './school-settings.js';
import { collect } from './student-files.js';

/**
 * Works and screenshots are kept until the day the school chose, then deleted by themselves
 * (CLAUDE.md §3.4; stage 5, A4; ADR-021). "Keep until 31 July" means: on 1 August, in Tashkent,
 * everything made before that day goes — screenshots, the files of "Мои работы" not changed since,
 * and the files handed in at a practice. Grades, marks and the reports of the checks stay.
 */

/** Uzbekistan's time, all year: UTC+5. */
const TASHKENT_OFFSET_MS = 5 * 3_600_000;

/** The moment the keeping ends in `year`: the start of the day after `MM-DD`, in Tashkent. */
function endOfKeeping(keepWorksUntil: string, year: number): Date {
  const [m, d] = keepWorksUntil.split('-').map(Number);
  return new Date(Date.UTC(year, (m ?? 7) - 1, (d ?? 31) + 1) - TASHKENT_OFFSET_MS);
}

/** The last cleaning before `now` and the next one after it. */
export function retentionCutoffs(keepWorksUntil: string, now: Date): { last: Date; next: Date } {
  const year = new Date(now.getTime() + TASHKENT_OFFSET_MS).getUTCFullYear();
  const thisYear = endOfKeeping(keepWorksUntil, year);
  return thisYear.getTime() <= now.getTime()
    ? { last: thisYear, next: endOfKeeping(keepWorksUntil, year + 1) }
    : { last: endOfKeeping(keepWorksUntil, year - 1), next: thisYear };
}

export interface PurgeCounts {
  screenshots: number;
  files: number;
  practiceFiles: number;
}

/** Counts — or deletes — what of these classes was made before `cutoff`. */
function sweep(
  db: Db,
  dataDir: string,
  classIds: string[],
  cutoff: Date,
  purge: boolean,
): PurgeCounts {
  const counts: PurgeCounts = { screenshots: 0, files: 0, practiceFiles: 0 };
  if (classIds.length === 0) return counts;
  const before = cutoff.toISOString();
  const students = db
    .select({ id: schema.students.id })
    .from(schema.students)
    .where(inArray(schema.students.classId, classIds))
    .all()
    .map((s) => s.id);
  if (students.length === 0) return counts;

  const shots = db
    .select()
    .from(schema.screenshots)
    .where(
      and(inArray(schema.screenshots.studentId, students), lt(schema.screenshots.takenAt, before)),
    )
    .all();
  counts.screenshots = shots.length;

  const files = db
    .select()
    .from(schema.studentFiles)
    .where(
      and(
        inArray(schema.studentFiles.studentId, students),
        isNull(schema.studentFiles.deletedAt),
        lt(schema.studentFiles.updatedAt, before),
      ),
    )
    .all();
  counts.files = files.length;

  const checks = db
    .select({
      sessionId: schema.practiceChecks.sessionId,
      studentId: schema.practiceChecks.studentId,
      fileSha: schema.practiceChecks.fileSha,
      submittedSha: schema.practiceChecks.submittedSha,
    })
    .from(schema.practiceChecks)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.practiceChecks.sessionId))
    .where(
      and(
        inArray(schema.sessions.classId, classIds),
        lt(schema.sessions.startedAt, before),
        or(isNotNull(schema.practiceChecks.fileSha), isNotNull(schema.practiceChecks.submittedSha)),
      ),
    )
    .all();
  counts.practiceFiles = checks.length;

  if (!purge) return counts;

  for (const shot of shots) {
    rmSync(join(dataDir, shot.fileKey), { force: true });
    db.delete(schema.screenshots).where(eq(schema.screenshots.id, shot.id)).run();
  }
  // Deleted here only: a school computer must not send "deleted" for a file the child may have
  // changed at home since (its copy here is older), and the platform keeps no tombstones of its own.
  for (const file of files) {
    db.delete(schema.studentFiles).where(eq(schema.studentFiles.id, file.id)).run();
    collect(db, dataDir, file.sha256);
  }
  for (const check of checks) {
    db.update(schema.practiceChecks)
      .set({ fileSha: null, submittedSha: null })
      .where(
        and(
          eq(schema.practiceChecks.sessionId, check.sessionId),
          eq(schema.practiceChecks.studentId, check.studentId),
        ),
      )
      .run();
    collect(db, dataDir, check.fileSha);
    collect(db, dataDir, check.submittedSha);
  }
  return counts;
}

/** Classes grouped by the rules they follow: each school's, and the personal classes' defaults. */
function classesBySchool(db: Db): Map<string | null, string[]> {
  const groups = new Map<string | null, string[]>();
  for (const c of db
    .select({ id: schema.classes.id, schoolId: schema.classes.schoolId })
    .from(schema.classes)
    .all()) {
    const list = groups.get(c.schoolId) ?? [];
    list.push(c.id);
    groups.set(c.schoolId, list);
  }
  return groups;
}

/** One cleaning over every school: what is past its school's day goes. */
export function purgeOldWorks(db: Db, dataDir: string, now = new Date()): PurgeCounts {
  const total: PurgeCounts = { screenshots: 0, files: 0, practiceFiles: 0 };
  for (const [schoolId, classIds] of classesBySchool(db)) {
    const { last } = retentionCutoffs(settingsOfSchool(db, schoolId).keepWorksUntil, now);
    const done = sweep(db, dataDir, classIds, last, true);
    total.screenshots += done.screenshots;
    total.files += done.files;
    total.practiceFiles += done.practiceFiles;
  }
  return total;
}

/** For the administrator: when the next cleaning is, and what it would take today. */
export function retentionPreview(
  db: Db,
  dataDir: string,
  schoolId: string,
  now = new Date(),
): RetentionPreview {
  const { next } = retentionCutoffs(settingsOfSchool(db, schoolId).keepWorksUntil, now);
  const classIds = classesBySchool(db).get(schoolId) ?? [];
  const counts = sweep(db, dataDir, classIds, next, false);
  return {
    // The day it happens, in Tashkent.
    on: new Date(next.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10),
    ...counts,
  };
}

/** Runs the cleaning now and then, on the platform and on a school computer alike. */
export class RetentionWorker {
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly dataDir: string,
    private readonly log: FastifyBaseLogger,
    private readonly everyMs = 6 * 3_600_000,
    private readonly firstAfterMs = 60_000,
  ) {}

  run(now = new Date()): PurgeCounts {
    const counts = purgeOldWorks(this.db, this.dataDir, now);
    if (counts.screenshots + counts.files + counts.practiceFiles > 0) {
      this.log.info(counts, 'old works deleted by the school rules');
    }
    return counts;
  }

  start(): void {
    const safely = () => {
      try {
        this.run();
      } catch (error) {
        this.log.error({ err: error }, 'cleaning old works failed');
      }
    };
    // Not at once: a server starting up has other things to do first.
    this.first ??= setTimeout(safely, this.firstAfterMs);
    this.first.unref?.();
    this.timer ??= setInterval(safely, this.everyMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
    this.first = null;
    this.timer = null;
  }
}
