import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  LessonSyncResponseSchema,
  SchoolSnapshotSchema,
  type SchoolSnapshot,
  type SyncStatus,
} from '@sinf/shared';
import { readPlatformLink, type Config, type PlatformLink } from '../config.js';
import { schema, type Db } from '../db/index.js';
import { applySchoolSnapshot } from './mirror.js';
import {
  buildLessonBundle,
  countPending,
  countPendingScreenshots,
  markScreenshotSynced,
  markSynced,
  pendingScreenshots,
  pendingSessionIds,
} from './outbox.js';
import { countDirtyFiles, pullFiles, pushFiles } from './files.js';
import { pullLessons } from './lessons.js';

/**
 * The school computer's side of S2.6 (ADR-011): it pulls the school's roster down and pushes what
 * the lessons produced up, whenever there happens to be a connection.
 *
 * No connection is not an error here. The lesson has already happened and the results are safe in
 * this computer's own database; this worker only keeps trying until the platform confirms it has
 * them. Until then nothing is deleted and nothing is marked as sent.
 */

const ROSTER_KEY = 'roster_version';
const ROSTER_AT_KEY = 'roster_at';
const LAST_SYNC_KEY = 'last_sync_at';
const LAST_ERROR_KEY = 'last_error';
/**
 * The one "error" that is not a fault: the classroom has no internet right now. The teacher's panel
 * knows this word and says nothing about it — "waiting for a connection" already says enough.
 */
const OFFLINE = 'offline';

export interface SyncWorkerOptions {
  /** How often to look for lessons waiting to go up. A tick with nothing to send touches no network. */
  pushEveryMs?: number;
  /** How often to ask the platform for the school's roster. */
  pullEveryMs?: number;
  fetchImpl?: typeof fetch;
}

export class SyncWorker {
  private readonly pushEveryMs: number;
  private readonly pullEveryMs: number;
  private readonly fetchImpl: typeof fetch;
  private pushTimer: NodeJS.Timeout | null = null;
  private pullTimer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private lastPullAt = 0;

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
    options: SyncWorkerOptions = {},
  ) {
    this.pushEveryMs = options.pushEveryMs ?? 60_000;
    this.pullEveryMs = options.pullEveryMs ?? 10 * 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Is this server a school computer at all? Decided per call: pairing can happen while it runs. */
  link(): PlatformLink | null {
    return readPlatformLink(this.config);
  }

  start(): void {
    this.stopped = false;
    this.pushTimer ??= setInterval(() => void this.push(), this.pushEveryMs);
    this.pullTimer ??= setInterval(() => void this.pull(), this.pullEveryMs);
    this.pushTimer.unref?.();
    this.pullTimer.unref?.();
    void this.syncNow();
  }

  stop(): void {
    // A request may still be in the air; whatever comes back must not touch a closed database.
    this.stopped = true;
    if (this.pushTimer) clearInterval(this.pushTimer);
    if (this.pullTimer) clearInterval(this.pullTimer);
    this.pushTimer = null;
    this.pullTimer = null;
  }

  /** Roster down, then results up. Used at startup and by the teacher's "send now" button. */
  async syncNow(): Promise<void> {
    await this.pull();
    await this.push();
  }

  /** Asks the platform for the school's roster and writes it here if it changed. */
  async pull(): Promise<SchoolSnapshot | null> {
    const link = this.link();
    if (!link || this.stopped) return null;
    try {
      const response = await this.fetchImpl(`${link.url}/api/sync/snapshot`, {
        headers: { authorization: `Device ${link.deviceToken}` },
      });
      if (!response.ok) {
        this.note(LAST_ERROR_KEY, `snapshot ${response.status}`);
        return null;
      }
      const snapshot = SchoolSnapshotSchema.parse(await response.json());
      // The server may have been shut down while the platform was answering.
      if (this.stopped) return null;
      this.lastPullAt = Date.now();
      if (this.read(ROSTER_KEY) === snapshot.version) {
        await this.pullLessons(link);
        this.note(LAST_SYNC_KEY, new Date().toISOString());
        this.note(LAST_ERROR_KEY, null);
        return snapshot;
      }
      const result = applySchoolSnapshot(this.db, snapshot);
      this.note(ROSTER_KEY, snapshot.version);
      this.note(ROSTER_AT_KEY, new Date().toISOString());
      this.note(LAST_SYNC_KEY, new Date().toISOString());
      this.note(LAST_ERROR_KEY, null);
      this.log.info({ ...result, version: snapshot.version }, 'school roster updated');
      // After the roster: a lesson's owner must be a known teacher here.
      await this.pullLessons(link);
      return snapshot;
    } catch (error) {
      // No internet in the classroom is the normal case, not a fault worth shouting about.
      this.note(LAST_ERROR_KEY, OFFLINE);
      this.log.debug({ err: error }, 'roster not fetched');
      return null;
    }
  }

  /** The school's own lessons (ADR-019); a failure here leaves the roster as it is. */
  private async pullLessons(link: PlatformLink): Promise<void> {
    try {
      const result = await pullLessons(this.db, this.config.dataDir, link, this.fetchImpl);
      if (result.updated + result.removed + result.files > 0) {
        this.log.info(result, 'school lessons updated');
      }
    } catch (error) {
      this.log.debug({ err: error }, 'school lessons not fetched');
    }
  }

  /**
   * Sends every lesson that is still waiting, then the screenshots of lessons already there (H10).
   * Returns how many lessons the platform accepted.
   */
  async push(): Promise<number> {
    const link = this.link();
    if (!link || this.running || this.stopped) return 0;
    const waiting = pendingSessionIds(this.db);
    if (
      waiting.length === 0 &&
      pendingScreenshots(this.db, 1).length === 0 &&
      countDirtyFiles(this.db) === 0
    ) {
      return 0;
    }

    this.running = true;
    let sent = 0;
    try {
      let blocked = false;
      for (const id of waiting) {
        if (this.stopped) break;
        const bundle = buildLessonBundle(this.db, id);
        if (!bundle) continue;
        const response = await this.fetchImpl(`${link.url}/api/sync/lesson`, {
          method: 'POST',
          headers: {
            authorization: `Device ${link.deviceToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(bundle),
        });
        if (response.ok) {
          LessonSyncResponseSchema.parse(await response.json());
          if (this.stopped) break;
          markSynced(this.db, id);
          sent += 1;
          continue;
        }
        if (response.status === 404 || response.status === 409 || response.status === 400) {
          // The platform will never take this lesson: a class that is not ours, or a stale id.
          // It leaves the queue so one bad lesson cannot block the rest, and the reason is kept
          // where the teacher can see it rather than being swallowed.
          markSynced(this.db, id);
          this.note(LAST_ERROR_KEY, `lesson ${id} rejected (${response.status})`);
          this.log.warn({ sessionId: id, status: response.status }, 'lesson rejected by platform');
          continue;
        }
        this.note(LAST_ERROR_KEY, `lesson ${response.status}`);
        blocked = true;
        break; // 401 or a server problem: try the whole queue again on the next tick.
      }
      const shots = blocked || this.stopped ? 0 : await this.pushScreenshots(link);
      const files =
        blocked || this.stopped
          ? 0
          : await pushFiles(this.db, this.config.dataDir, link, this.fetchImpl, this.log);
      if (sent + shots + files > 0 && !this.stopped) {
        this.note(LAST_SYNC_KEY, new Date().toISOString());
        this.note(LAST_ERROR_KEY, null);
        this.log.info({ sent, shots, files }, 'lesson results sent to the platform');
      }
    } catch (error) {
      this.note(LAST_ERROR_KEY, OFFLINE);
      this.log.debug({ err: error }, 'results not sent');
    } finally {
      this.running = false;
    }
    return sent;
  }

  /**
   * A child logged into a lesson here: bring their folder from the platform, so what they did at
   * home is here (H12). Without a connection the lesson simply works with what this computer has.
   */
  async pullFiles(studentId: string): Promise<number> {
    const link = this.link();
    if (!link || this.stopped) return 0;
    try {
      return await pullFiles(this.db, this.config.dataDir, link, this.fetchImpl, studentId);
    } catch (error) {
      this.log.debug({ err: error, studentId }, 'student files not fetched');
      return 0;
    }
  }

  /**
   * Screenshots go one per request, a few dozen per tick: they are for looking at later, and must
   * not crowd the lessons or the classroom's thin connection. A network failure throws to `push`.
   */
  private async pushScreenshots(link: PlatformLink): Promise<number> {
    let sent = 0;
    for (const shot of pendingScreenshots(this.db)) {
      if (this.stopped) break;
      let jpeg: string;
      try {
        jpeg = (await readFile(join(this.config.dataDir, shot.fileKey))).toString('base64');
      } catch {
        // The file is gone from this computer; there is nothing left to send.
        markScreenshotSynced(this.db, shot.id);
        continue;
      }
      const response = await this.fetchImpl(`${link.url}/api/sync/screenshot`, {
        method: 'POST',
        headers: {
          authorization: `Device ${link.deviceToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id: shot.id,
          sessionId: shot.sessionId,
          studentId: shot.studentId,
          kind: shot.kind,
          takenAt: shot.takenAt,
          width: shot.width,
          height: shot.height,
          jpeg,
        }),
      });
      if (this.stopped) break;
      if (response.ok) {
        markScreenshotSynced(this.db, shot.id);
        sent += 1;
        continue;
      }
      if ([400, 404, 409, 413].includes(response.status)) {
        // The platform will never take this picture; it must not hold up the others.
        markScreenshotSynced(this.db, shot.id);
        this.log.warn({ id: shot.id, status: response.status }, 'screenshot rejected by platform');
        continue;
      }
      this.note(LAST_ERROR_KEY, `screenshot ${response.status}`);
      break;
    }
    return sent;
  }

  status(): SyncStatus {
    if (!this.link()) {
      return {
        mode: 'platform',
        pending: 0,
        pendingShots: 0,
        pendingFiles: 0,
        lastSyncAt: null,
        lastError: null,
        rosterAt: null,
      };
    }
    return {
      mode: 'school',
      pending: countPending(this.db),
      pendingShots: countPendingScreenshots(this.db),
      pendingFiles: countDirtyFiles(this.db),
      lastSyncAt: this.read(LAST_SYNC_KEY),
      lastError: this.read(LAST_ERROR_KEY),
      rosterAt: this.read(ROSTER_AT_KEY),
    };
  }

  /** When the roster was last asked for, in milliseconds; 0 if never (used by tests). */
  get lastRosterAt(): number {
    return this.lastPullAt;
  }

  private read(key: string): string | null {
    return (
      this.db.select().from(schema.syncState).where(eq(schema.syncState.key, key)).get()?.value ??
      null
    );
  }

  private note(key: string, value: string | null): void {
    if (this.stopped) return;
    this.db
      .insert(schema.syncState)
      .values({ key, value, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: schema.syncState.key,
        set: { value, updatedAt: new Date().toISOString() },
      })
      .run();
  }
}
