// Imports the author's HTML lessons into content/<course>/ (STAGE1.md S1.2).
// Usage: pnpm import:html <children file> <teacher file> <output dir>
// Example: pnpm import:html content-src/1-klass-2-chetvert/1_klass_2_chetvert.html \
//   content-src/1-klass-2-chetvert/1_klass_2_chetvert_uchitel.html content/1-klass-2-chetvert
import { resolve } from 'node:path';
import { importCourse, type ImportReport } from '../import/import-course.js';

const USAGE = 'Usage: pnpm import:html <children file> <teacher file> <output dir>';

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  if (args.length !== 3) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  // pnpm runs package scripts inside apps/server; resolve paths against the folder the command was typed in.
  const base = process.env['INIT_CWD'] ?? process.cwd();
  const [kidsFile, teacherFile, outDir] = args.map((a) => resolve(base, a)) as [
    string,
    string,
    string,
  ];
  const report = await importCourse({ kidsFile, teacherFile, outDir });
  printReport(report, outDir);
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)} KB`;
const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

function printReport(r: ImportReport, outDir: string): void {
  const lines = [
    `Import finished: ${outDir}`,
    `  lessons: ${r.lessons} (stages found in ${r.stagesFound})`,
    `  screens: ${r.screens.total} — slides ${r.authorSlides} (incl. Paint steps ${r.screens.step}), ` +
      `"type the word" ${r.screens.type}, trainer levels ${r.screens.game}`,
    `  trainer types: ${Object.entries(r.gameTypes)
      .map(([t, n]) => `${t} ${n}`)
      .join(', ')}`,
    `  images: ${r.media.files} WebP files, ${mb(r.media.bytes)} (source JPEG ${mb(r.media.sourceBytes)})`,
    `  total size: ${mb(r.totalBytes)}`,
    '  per lesson (screens / images / image weight):',
    ...r.perLesson.map(
      (l) =>
        `    ${l.id.padEnd(5)} ${String(l.screens).padStart(3)} / ${String(l.media).padStart(3)} / ${kb(l.mediaBytes)}`,
    ),
  ];
  console.log(lines.join('\n'));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
