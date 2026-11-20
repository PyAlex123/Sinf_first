import { parse } from 'parse5';
import { describe, expect, it } from 'vitest';
import {
  fillMissingStages,
  parseTimeline,
  parseTimelineSegment,
  screenStageKey,
} from '../../src/import/stages.js';

const TIMELINE = `<div class="timeline">
  <div class="seg " style="flex:2"><b>0–2</b><span>приветствие</span></div>
  <div class="seg " style="flex:3"><b>2–5</b><span>цель</span></div>
  <div class="seg show" style="flex:10"><b>5–15</b><span>теория</span></div>
  <div class="seg pc" style="flex:22"><b>15–37</b><span>практика: 9 + отдых 4 + 9</span></div>
  <div class="seg " style="flex:5"><b>37–42</b><span>выставка</span></div>
  <div class="seg " style="flex:3"><b>42–45</b><span>итог</span></div>
</div>`;

describe('parseTimeline', () => {
  it('reads stages, places and practice parts from the teacher scenario', () => {
    const stages = parseTimeline(parse(`<body>${TIMELINE}</body>`));
    expect(stages.map((s) => [s.key, s.startMin, s.endMin])).toEqual([
      ['greeting', 0, 2],
      ['goal', 2, 5],
      ['theory', 5, 15],
      ['practice', 15, 37],
      ['reflection', 37, 42],
      ['summary', 42, 45],
    ]);
    expect(stages[2]?.place).toBe('projector');
    expect(stages[3]).toMatchObject({
      place: 'computer',
      title: 'практика',
      parts: [
        { kind: 'work', minutes: 9 },
        { kind: 'rest', minutes: 4 },
        { kind: 'work', minutes: 9 },
      ],
    });
    expect(stages[4]?.title).toBe('выставка');
  });

  it('fails without a timeline or with gaps', () => {
    expect(() => parseTimeline(parse('<p>no plan</p>'))).toThrow(/not found/);
    const gap = TIMELINE.replace('<b>2–5</b>', '<b>3–5</b>');
    expect(() => parseTimeline(parse(gap))).toThrow(/not continuous/);
  });
});

describe('parseTimelineSegment', () => {
  it('checks that parts add up to the stage', () => {
    expect(() => parseTimelineSegment('15–37', 'практика: 9 + отдых 4 + 8', 'computer')).toThrow(
      /add up/,
    );
  });

  it('rejects unknown labels and ranges', () => {
    expect(() => parseTimelineSegment('0–2', 'перемена', null)).toThrow(/Unknown/);
    expect(() => parseTimelineSegment('0 до 2', 'итог', null)).toThrow(/Bad timeline range/);
  });
});

describe('stages of screens', () => {
  it('maps slide stage names', () => {
    expect(screenStageKey(' Теоретическая  часть ')).toBe('theory');
    expect(() => screenStageKey('Перемена')).toThrow();
  });

  it('gives a screen without stage the stage of the next screen, at the end — of the previous one', () => {
    expect(fillMissingStages([null, 'greeting', 'theory', null, null, 'practice', null])).toEqual([
      'greeting',
      'greeting',
      'theory',
      'practice',
      'practice',
      'practice',
      'practice',
    ]);
    expect(() => fillMissingStages([null, null])).toThrow();
  });
});
