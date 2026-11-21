import { strFromU8, unzipSync } from 'fflate';

/**
 * Opening an Office file (ADR-016). Only the XML parts a checker needs are unpacked — pictures and
 * media are skipped, so a document full of photographs is checked as fast as an empty one.
 */

export class FileProblem extends Error {
  constructor(readonly kind: 'unreadable' | 'old_or_protected') {
    super(kind);
    this.name = 'FileProblem';
  }
}

/** A part bigger than this is not a school document; it is not unpacked. */
const MAX_PART_BYTES = 20 * 1024 * 1024;

const ZIP = [0x50, 0x4b, 0x03, 0x04];
/** Compound File: an old .doc/.xls/.ppt, or a new one saved with a password. */
const OLE = [0xd0, 0xcf, 0x11, 0xe0];

const startsWith = (bytes: Uint8Array, magic: number[]): boolean =>
  magic.every((b, i) => bytes[i] === b);

export interface OfficeParts {
  get(name: string): string | undefined;
  names(): string[];
}

export function openOffice(bytes: Uint8Array, wanted: (name: string) => boolean): OfficeParts {
  if (startsWith(bytes, OLE)) throw new FileProblem('old_or_protected');
  if (!startsWith(bytes, ZIP)) throw new FileProblem('unreadable');
  let files: Record<string, Uint8Array>;
  const all: string[] = [];
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        all.push(f.name);
        return f.originalSize <= MAX_PART_BYTES && wanted(f.name);
      },
    });
  } catch {
    throw new FileProblem('unreadable');
  }
  const text = new Map<string, string>();
  return {
    get(name) {
      if (text.has(name)) return text.get(name);
      const raw = files[name];
      if (!raw) return undefined;
      const s = strFromU8(raw);
      text.set(name, s);
      return s;
    },
    names: () => all,
  };
}

/** The targets of a part's relationships: rId → path inside the package. */
export function relationships(
  parts: OfficeParts,
  part: string,
  parse: (xml: string) => { id: string; target: string; type: string }[],
): Map<string, { target: string; type: string }> {
  const slash = part.lastIndexOf('/');
  const dir = part.slice(0, slash);
  const relsPath = `${dir}/_rels/${part.slice(slash + 1)}.rels`;
  const xml = parts.get(relsPath);
  const out = new Map<string, { target: string; type: string }>();
  if (!xml) return out;
  for (const r of parse(xml)) {
    out.set(r.id, { target: resolvePath(dir, r.target), type: r.type });
  }
  return out;
}

/** "slides/slide1.xml" seen from "ppt" → "ppt/slides/slide1.xml"; "/xl/x.xml" → "xl/x.xml". */
export function resolvePath(dir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = dir ? dir.split('/') : [];
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.' && piece !== '') parts.push(piece);
  }
  return parts.join('/');
}
