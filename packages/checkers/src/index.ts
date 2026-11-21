import {
  extensionOf,
  type CheckReport,
  type Criterion,
  type CriterionResult,
  type PracticeCheck,
} from '@sinf/shared';
import { loadDocx, runDocx, type DocxModel } from './docx.js';
import { loadCss, loadHtml, runHtml, type HtmlModel } from './html.js';
import { loadPptx, runPptx, type PptxModel } from './pptx.js';
import { decodeText } from './text.js';
import { runTxt } from './txt.js';
import { unknown, type Verdict } from './verdict.js';
import { loadXlsx, runXlsx, type XlsxModel } from './xlsx.js';
import { FileProblem } from './zip.js';

/**
 * Practice file checkers (CLAUDE.md §4.7; ADR-003, ADR-016): a saved file and the task's criteria in,
 * a verdict per criterion out. The same code runs in the browser, inside the classroom app's
 * WebView2 and on the server; no network, no Office.
 *
 * Each criterion is "pass", "fail" or "unknown" — the checker cannot tell, and the teacher looks.
 * A file the checker cannot read at all (an old .doc, a password, not the format its name says)
 * makes every automatic criterion "unknown", never "fail": a child must not get a 2 because Word
 * saved in an older format.
 */

export { decodeText } from './text.js';
export { parseCss } from './css.js';
export { formatKind } from './xlsx.js';
export { readTables, type ReadTable } from './tables.js';
export { FileProblem } from './zip.js';

type Family = 'docx' | 'xlsx' | 'pptx' | 'html' | 'css' | 'txt';

function familyOfFile(name: string): Family | null {
  const ext = extensionOf(name);
  if (ext === 'docx') return 'docx';
  if (ext === 'xlsx') return 'xlsx';
  if (ext === 'pptx') return 'pptx';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'css') return 'css';
  if (ext === 'txt' || ext === 'csv' || ext === 'py' || ext === 'ino') return 'txt';
  return null;
}

/** Which kinds of file a check can look at. Text checks work on any text file. */
function fits(check: PracticeCheck, family: Family): boolean {
  const prefix = check.type.split('.')[0];
  if (prefix === 'txt') return family === 'txt' || family === 'html' || family === 'css';
  if (prefix === 'html') return family === 'html';
  if (prefix === 'css') return family === 'html' || family === 'css';
  return prefix === family;
}

interface Loaded {
  docx?: DocxModel;
  xlsx?: XlsxModel;
  pptx?: PptxModel;
  html?: HtmlModel;
  text?: string;
}

function load(bytes: Uint8Array, family: Family): Loaded {
  switch (family) {
    case 'docx':
      return { docx: loadDocx(bytes) };
    case 'xlsx':
      return { xlsx: loadXlsx(bytes) };
    case 'pptx':
      return { pptx: loadPptx(bytes) };
    case 'html': {
      const text = decodeText(bytes);
      return { text, html: loadHtml(text) };
    }
    case 'css': {
      const text = decodeText(bytes);
      return { text, html: loadCss(text) };
    }
    case 'txt':
      return { text: decodeText(bytes) };
  }
}

function run(loaded: Loaded, check: PracticeCheck): Verdict {
  const t = check.type;
  if (t.startsWith('docx.') && loaded.docx)
    return runDocx(loaded.docx, check as Parameters<typeof runDocx>[1]);
  if (t.startsWith('xlsx.') && loaded.xlsx)
    return runXlsx(loaded.xlsx, check as Parameters<typeof runXlsx>[1]);
  if (t.startsWith('pptx.') && loaded.pptx)
    return runPptx(loaded.pptx, check as Parameters<typeof runPptx>[1]);
  if ((t.startsWith('html.') || t.startsWith('css.')) && loaded.html) {
    return runHtml(loaded.html, check as Parameters<typeof runHtml>[1]);
  }
  if (t.startsWith('txt.') && loaded.text !== undefined)
    return runTxt(loaded.text, check as Parameters<typeof runTxt>[1]);
  return unknown('эту проверку нельзя сделать для такого файла');
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function checkFile(
  bytes: Uint8Array,
  fileName: string,
  criteria: readonly Criterion[],
): CheckReport {
  const started = now();
  const auto = criteria.filter((c) => c.kind === 'auto');
  const autoMax = auto.reduce((sum, c) => sum + c.points, 0);
  const family = familyOfFile(fileName);

  const allUnknown = (file: CheckReport['file'], found: string): CheckReport => ({
    file,
    results: auto.map((c): CriterionResult => ({ id: c.id, outcome: 'unknown', found })),
    autoScore: 0,
    autoMax,
    ms: now() - started,
  });

  if (!family) return allUnknown('wrong_type', 'файл не того типа');
  let loaded: Loaded;
  try {
    loaded = load(bytes, family);
  } catch (error) {
    if (error instanceof FileProblem && error.kind === 'old_or_protected') {
      return allUnknown(
        'old_or_protected',
        'файл старого формата или с паролем — проверит учитель',
      );
    }
    return allUnknown('unreadable', 'файл не открывается — проверит учитель');
  }

  const results = auto.map((c): CriterionResult => {
    if (c.kind !== 'auto') return { id: c.id, outcome: 'unknown', found: null };
    let v: Verdict;
    try {
      v = fits(c.check, family)
        ? run(loaded, c.check)
        : unknown('эта проверка не для такого файла');
    } catch {
      v = unknown('не удалось проверить — проверит учитель');
    }
    return { id: c.id, outcome: v.outcome, found: v.found };
  });
  const autoScore = results.reduce(
    (sum, r) => sum + (r.outcome === 'pass' ? (auto.find((c) => c.id === r.id)?.points ?? 0) : 0),
    0,
  );
  return { file: 'ok', results, autoScore, autoMax, ms: now() - started };
}
export { readSlides, type ReadSlide } from './slides.js';
