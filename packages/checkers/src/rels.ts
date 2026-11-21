import { attr, descendants, parseXml } from './xml.js';

/** Parses a `.rels` part. */
export function parseRels(xml: string): { id: string; target: string; type: string }[] {
  return descendants(parseXml(xml), 'Relationship').map((r) => ({
    id: attr(r, 'Id') ?? '',
    target: attr(r, 'Target') ?? '',
    type: attr(r, 'Type') ?? '',
  }));
}
