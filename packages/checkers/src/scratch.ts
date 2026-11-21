import type { PracticeCheck } from '@sinf/shared';
import { verdict, type Verdict } from './verdict.js';
import { FileProblem, openOffice } from './zip.js';

/**
 * Scratch 3 projects (`.sb3`; stage 6, B5; ADR-016, addendum B5). An `.sb3` is a ZIP whose
 * `project.json` lists the stage and the sprites ("targets"); each target keeps its scripts as a
 * flat map of blocks, every block naming what it does by opcode. Costumes and sounds are not
 * unpacked.
 */

type Sb3Check = Extract<PracticeCheck, { type: `sb3.${string}` }>;

export interface Sb3Model {
  sprites: number;
  /** Opcodes of the blocks in scripts; the menus inside blocks ("shadows") are not blocks to a child. */
  opcodes: string[];
  /** Variables and lists, of the stage and of every sprite. */
  variables: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const size = (v: unknown): number => (isRecord(v) ? Object.keys(v).length : 0);

export function loadSb3(bytes: Uint8Array): Sb3Model {
  const parts = openOffice(bytes, (name) => name === 'project.json');
  const json = parts.get('project.json');
  if (!json) throw new FileProblem('unreadable');
  let project: unknown;
  try {
    project = JSON.parse(json);
  } catch {
    throw new FileProblem('unreadable');
  }
  const targets = isRecord(project) && Array.isArray(project.targets) ? project.targets : null;
  if (!targets) throw new FileProblem('unreadable');
  const model: Sb3Model = { sprites: 0, opcodes: [], variables: 0 };
  for (const target of targets) {
    if (!isRecord(target)) continue;
    if (target.isStage !== true) model.sprites += 1;
    model.variables += size(target.variables) + size(target.lists);
    if (!isRecord(target.blocks)) continue;
    // A variable dropped on the workspace by itself is stored as an array, not a block.
    for (const block of Object.values(target.blocks)) {
      if (isRecord(block) && typeof block.opcode === 'string' && block.shadow !== true) {
        model.opcodes.push(block.opcode);
      }
    }
  }
  return model;
}

const LOOPS = ['control_repeat', 'control_forever', 'control_repeat_until', 'control_while'];
const CONDITIONS = ['control_if', 'control_if_else', 'control_wait_until'];
const SOUNDS = ['sound_play', 'sound_playuntildone'];

export function runSb3(model: Sb3Model, check: Sb3Check): Verdict {
  const has = (opcodes: readonly string[]): boolean =>
    model.opcodes.some((o) => opcodes.includes(o));
  switch (check.type) {
    case 'sb3.sprites':
      return verdict(model.sprites >= check.min, `спрайтов: ${model.sprites}`);
    case 'sb3.flag':
      return verdict(has(['event_whenflagclicked']), null);
    case 'sb3.loop':
      return verdict(has(LOOPS), null);
    case 'sb3.condition':
      return verdict(has(CONDITIONS), null);
    case 'sb3.variable':
      return verdict(model.variables >= check.min, `переменных и списков: ${model.variables}`);
    case 'sb3.sound':
      return verdict(has(SOUNDS), null);
    case 'sb3.blocks':
      return verdict(model.opcodes.length >= check.min, `блоков: ${model.opcodes.length}`);
    case 'sb3.block': {
      const n = model.opcodes.filter((o) => o === check.opcode).length;
      return verdict(n >= check.min, `таких блоков: ${n}`);
    }
  }
}
