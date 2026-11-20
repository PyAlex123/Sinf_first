import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import type { ContentManifest, ContentManifestCourse, ContentManifestFile } from '@sinf/shared';

/**
 * The list of everything a school computer needs to hold a lesson without the internet (S2.5): every
 * file of every course with its hash and size. Built once at startup — about 240 files, and recounting
 * them on each request would buy nothing.
 *
 * Media files are already named by their content hash (ADR-005), so a name never changes meaning: a
 * computer only ever has to fetch what it is missing.
 */

/** Files the app has no use for; the scenarios the teacher reads are part of the lesson and stay. */
const SKIP = new Set(['.manifest.json', '.DS_Store', 'Thumbs.db']);

function walk(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, full, out);
    } else if (entry.isFile() && !SKIP.has(entry.name)) {
      // Always with forward slashes: the same path travels to Windows and back.
      out.push(relative(root, full).split(sep).join(posix.sep));
    }
  }
}

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

export function buildContentManifest(contentDir: string): ContentManifest {
  const courses: ContentManifestCourse[] = [];
  for (const entry of readdirSync(contentDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory()) continue;
    const courseDir = join(contentDir, entry.name);
    const names: string[] = [];
    walk(courseDir, courseDir, names);
    const files: ContentManifestFile[] = names.map((name) => {
      const full = join(courseDir, ...name.split(posix.sep));
      return {
        path: `${entry.name}/${name}`,
        sha256: sha256(readFileSync(full)),
        size: statSync(full).size,
      };
    });
    if (files.length === 0) continue;
    courses.push({
      id: entry.name,
      // One short string that changes whenever any file of the course does.
      version: sha256(Buffer.from(files.map((f) => `${f.path}:${f.sha256}`).join('\n'))).slice(0, 16),
      files,
    });
  }
  const totalBytes = courses.reduce(
    (sum, course) => sum + course.files.reduce((n, file) => n + file.size, 0),
    0,
  );
  return { courses, totalBytes };
}
