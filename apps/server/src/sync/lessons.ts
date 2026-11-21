import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { eq, isNull } from 'drizzle-orm';
import {
  AssetExtensionSchema,
  lessonAssetFiles,
  SyncAuthoredLessonSchema,
  SyncLessonListSchema,
} from '@sinf/shared';
import type { PlatformLink } from '../config.js';
import { schema, type Db } from '../db/index.js';
import { assetPath, storeAsset } from '../services/assets.js';

/**
 * The school's own lessons come down to a school computer (stage 4, W1; ADR-019): every lesson of a
 * teacher of this school, read-only, with the pictures and templates it names. Only versions that
 * changed are fetched; a lesson gone from the platform is marked deleted here, and stays findable
 * by id for the results of the lessons already held with it.
 */

const auth = (link: PlatformLink) => ({ authorization: `Device ${link.deviceToken}` });

export interface LessonPullResult {
  updated: number;
  removed: number;
  files: number;
}

export async function pullLessons(
  db: Db,
  dataDir: string,
  link: PlatformLink,
  fetchImpl: typeof fetch,
): Promise<LessonPullResult> {
  const result: LessonPullResult = { updated: 0, removed: 0, files: 0 };
  const listed = await fetchImpl(`${link.url}/api/sync/lessons`, { headers: auth(link) });
  if (!listed.ok) throw new Error(`lessons ${listed.status}`);
  const remote = SyncLessonListSchema.parse(await listed.json()).lessons;

  const local = new Map(
    db
      .select({
        id: schema.authoredLessons.id,
        version: schema.authoredLessons.version,
        updatedAt: schema.authoredLessons.updatedAt,
        deletedAt: schema.authoredLessons.deletedAt,
      })
      .from(schema.authoredLessons)
      .all()
      .map((r) => [r.id, r]),
  );
  const known = new Set(
    db
      .select({ id: schema.users.id })
      .from(schema.users)
      .all()
      .map((u) => u.id),
  );

  for (const item of remote) {
    const here = local.get(item.id);
    const fresh =
      here && !here.deletedAt && here.version === item.version && here.updatedAt === item.updatedAt;
    if (!fresh) {
      const response = await fetchImpl(`${link.url}/api/sync/lessons/${item.id}`, {
        headers: auth(link),
      });
      if (!response.ok) continue;
      const lesson = SyncAuthoredLessonSchema.parse(await response.json());
      // The roster brings the teachers; a lesson of someone not in it yet waits for the next pull.
      if (!known.has(lesson.ownerId)) continue;
      const values = { ...lesson, deletedAt: null };
      db.insert(schema.authoredLessons)
        .values(values)
        .onConflictDoUpdate({ target: schema.authoredLessons.id, set: values })
        .run();
      result.updated += 1;
    }
  }

  // Files the lessons name and this computer lacks: fetched once, checked against their name.
  const docs = db
    .select({ doc: schema.authoredLessons.doc })
    .from(schema.authoredLessons)
    .where(isNull(schema.authoredLessons.deletedAt))
    .all();
  const wanted = new Set(docs.flatMap((d) => lessonAssetFiles(d.doc)));
  for (const file of wanted) {
    const [sha = '', extRaw = ''] = file.split('.');
    const ext = AssetExtensionSchema.safeParse(extRaw);
    if (!ext.success || existsSync(assetPath(dataDir, sha, ext.data))) continue;
    const response = await fetchImpl(`${link.url}/content/_assets/${file}`);
    if (!response.ok) continue;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== sha) continue;
    storeAsset(dataDir, bytes, ext.data);
    result.files += 1;
  }

  const listedIds = new Set(remote.map((r) => r.id));
  const at = new Date().toISOString();
  for (const [id, here] of local) {
    if (here.deletedAt || listedIds.has(id)) continue;
    db.update(schema.authoredLessons)
      .set({ deletedAt: at })
      .where(eq(schema.authoredLessons.id, id))
      .run();
    result.removed += 1;
  }
  return result;
}
