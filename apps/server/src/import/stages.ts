import type { Stage, StageKey, StagePart } from '@sinf/shared';
import { findAll, hasClass, textContent, type ParentNode } from './dom.js';

/** Stage names on children's slides (`.s-stage`) and in trainer levels (`stage`). */
const SCREEN_STAGE_NAMES: Record<string, StageKey> = {
  приветствие: 'greeting',
  'постановка цели': 'goal',
  'теоретическая часть': 'theory',
  'практическая часть': 'practice',
  рефлексия: 'reflection',
  заключение: 'summary',
};

/** Stage labels in the teacher's timeline ("0–2 приветствие · 2–5 цель · …"). */
const TIMELINE_STAGE_NAMES: Record<string, StageKey> = {
  приветствие: 'greeting',
  цель: 'goal',
  теория: 'theory',
  практика: 'practice',
  рефлексия: 'reflection',
  выставка: 'reflection',
  итог: 'summary',
  заключение: 'summary',
};

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

export function screenStageKey(name: string): StageKey {
  const key = SCREEN_STAGE_NAMES[normalize(name)];
  if (!key) {
    throw new Error(`Unknown screen stage "${name}"`);
  }
  return key;
}

/**
 * Some screens carry no stage (title slides, "type the word" tasks). They take the stage of the next screen
 * that has one: the title opens the greeting, typing tasks sit right before the practice trainer.
 * Screens at the very end take the stage of the previous screen.
 */
export function fillMissingStages(stages: readonly (StageKey | null)[]): StageKey[] {
  const result: (StageKey | null)[] = [...stages];
  for (let i = result.length - 2; i >= 0; i--) {
    result[i] ??= result[i + 1] ?? null;
  }
  for (let i = 1; i < result.length; i++) {
    result[i] ??= result[i - 1] ?? null;
  }
  return result.map((key, i) => {
    if (!key) {
      throw new Error(`Screen ${i + 1}: no stage found in the whole lesson`);
    }
    return key;
  });
}

/**
 * Parses the timeline of a teacher scenario:
 * `<div class="timeline"><div class="seg pc"><b>15–37</b><span>практика: 9 + отдых 4 + 9</span></div>…</div>`.
 * Segment classes: `show` — projector, `pc` — at the computer.
 */
export function parseTimeline(root: ParentNode): Stage[] {
  const timeline = findAll(root, (el) => hasClass(el, 'timeline'))[0];
  if (!timeline) {
    throw new Error('Timeline (.timeline) not found');
  }
  const segments = findAll(timeline, (el) => hasClass(el, 'seg'));
  if (segments.length === 0) {
    throw new Error('Timeline has no segments');
  }
  const stages = segments.map((seg) => {
    const range = findAll(seg, (el) => el.tagName === 'b')[0];
    const label = findAll(seg, (el) => el.tagName === 'span')[0];
    if (!range || !label) {
      throw new Error('Timeline segment must contain <b>range</b> and <span>label</span>');
    }
    const place = hasClass(seg, 'show') ? 'projector' : hasClass(seg, 'pc') ? 'computer' : null;
    return parseTimelineSegment(textContent(range), textContent(label), place);
  });
  stages.forEach((stage, i) => {
    const prev = stages[i - 1];
    if (prev ? prev.endMin !== stage.startMin : stage.startMin !== 0) {
      throw new Error(`Timeline is not continuous at "${stage.title}"`);
    }
  });
  return stages;
}

export function parseTimelineSegment(range: string, label: string, place: Stage['place']): Stage {
  const minutes = /^\s*(\d+)\s*[–—-]\s*(\d+)\s*$/.exec(range);
  if (!minutes?.[1] || !minutes[2]) {
    throw new Error(`Bad timeline range "${range}"`);
  }
  const startMin = Number(minutes[1]);
  const endMin = Number(minutes[2]);
  const [namePart = '', partsPart] = label.split(':');
  const title = normalize(namePart);
  const key = TIMELINE_STAGE_NAMES[title];
  if (!key) {
    throw new Error(`Unknown timeline stage "${label}"`);
  }
  const stage: Stage = { key, title, startMin, endMin, place };
  if (partsPart !== undefined) {
    const parts = parseParts(partsPart);
    const total = parts.reduce((sum, p) => sum + p.minutes, 0);
    if (total !== endMin - startMin) {
      throw new Error(
        `Stage "${label}": parts add up to ${total} min, stage lasts ${endMin - startMin} min`,
      );
    }
    stage.parts = parts;
  }
  return stage;
}

/** "9 + отдых 4 + 9" → work 9, rest 4, work 9. */
function parseParts(text: string): StagePart[] {
  return text.split('+').map((chunk) => {
    const match = /^\s*(отдых\s+)?(\d+)\s*(?:мин\.?)?\s*$/i.exec(chunk);
    if (!match?.[2]) {
      throw new Error(`Bad stage part "${chunk.trim()}"`);
    }
    return { kind: match[1] ? 'rest' : 'work', minutes: Number(match[2]) };
  });
}
