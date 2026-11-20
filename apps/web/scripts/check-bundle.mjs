// Fails the build if the JavaScript of the initial page load exceeds the budget (CLAUDE.md §3.1: ≤ 200 KB gzip).
// Reads Vite's manifest and sums the entry chunk with everything it imports statically.
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 200 * 1024;
const dist = resolve(import.meta.dirname, '../dist');
const manifestPath = resolve(dist, '.vite/manifest.json');

/** @type {Record<string, { file: string; isEntry?: boolean; imports?: string[]; css?: string[] }>} */
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry);
if (entries.length === 0) {
  console.error('check-bundle: no entry chunk in manifest');
  process.exit(1);
}

/** @type {Set<string>} */
const seen = new Set();
/** @type {string[]} */
const files = [];
/** @param {string} key */
function visit(key) {
  if (seen.has(key)) return;
  seen.add(key);
  const chunk = manifest[key];
  if (!chunk) return;
  files.push(chunk.file);
  for (const dep of chunk.imports ?? []) visit(dep);
}
for (const [key] of entries) visit(key);

let raw = 0;
let gzip = 0;
const rows = [];
for (const file of files) {
  const bytes = readFileSync(resolve(dist, file));
  const g = gzipSync(bytes).length;
  raw += statSync(resolve(dist, file)).size;
  gzip += g;
  rows.push(`  ${file.padEnd(40)} ${(g / 1024).toFixed(1).padStart(7)} KB gzip`);
}
console.log('Initial JS bundle:');
console.log(rows.join('\n'));
console.log(
  `  total ${(gzip / 1024).toFixed(1)} KB gzip (${(raw / 1024).toFixed(1)} KB raw), budget ${BUDGET_BYTES / 1024} KB`,
);
if (gzip > BUDGET_BYTES) {
  console.error(
    `check-bundle: initial JS exceeds the budget by ${((gzip - BUDGET_BYTES) / 1024).toFixed(1)} KB`,
  );
  process.exit(1);
}
