import { describe, expect, it } from 'vitest';
import { GameLevelSchema, LessonSchema, StageSchema, type Lesson } from '../src/index.js';

const stage = (key: string, startMin: number, endMin: number): unknown => ({
  key,
  title: key,
  startMin,
  endMin,
  place: null,
});

const lesson = (overrides: Partial<Record<keyof Lesson, unknown>> = {}): unknown => ({
  id: 'g10',
  group: 'gos',
  num: 10,
  title: 'Урок',
  sub: '',
  icon: '<svg></svg>',
  stages: [stage('greeting', 0, 2), stage('practice', 2, 45)],
  screens: [
    { kind: 'slide', stage: 'greeting', layout: 'title', html: '<h1>Урок</h1>' },
    {
      kind: 'game',
      stage: 'practice',
      n: 1,
      level: { type: 'story', stars: 1, say: 'По порядку', cards: ['a', 'b'] },
    },
  ],
  teacherScenario: '/content/c/scenarios/g10.html',
  media: [],
  ...overrides,
});

describe('LessonSchema', () => {
  it('accepts a valid lesson', () => {
    expect(LessonSchema.safeParse(lesson()).success).toBe(true);
  });

  it('rejects a screen whose stage is not in the lesson', () => {
    const screens = [{ kind: 'slide', stage: 'summary', layout: 'text', html: '<p>x</p>' }];
    expect(LessonSchema.safeParse(lesson({ screens })).success).toBe(false);
  });

  it('rejects stages with gaps', () => {
    const stages = [stage('greeting', 0, 2), stage('practice', 3, 45)];
    expect(LessonSchema.safeParse(lesson({ stages })).success).toBe(false);
  });

  it('rejects unknown fields (format changes are noticed)', () => {
    expect(LessonSchema.safeParse(lesson({ extra: 1 } as never)).success).toBe(false);
  });
});

describe('StageSchema', () => {
  it('checks that parts add up to the duration', () => {
    const base = {
      key: 'practice',
      title: 'практика',
      startMin: 15,
      endMin: 37,
      place: 'computer',
    };
    const parts = (rest: number): unknown => [
      { kind: 'work', minutes: 9 },
      { kind: 'rest', minutes: rest },
      { kind: 'work', minutes: 9 },
    ];
    expect(StageSchema.safeParse({ ...base, parts: parts(4) }).success).toBe(true);
    expect(StageSchema.safeParse({ ...base, parts: parts(5) }).success).toBe(false);
  });
});

describe('GameLevelSchema', () => {
  it('accepts all six level types', () => {
    const levels = [
      { type: 'story', stars: 1, say: 's', cards: ['sun', 'rain'] },
      {
        type: 'pick',
        stars: 1,
        say: 's',
        opts: [
          ['pic', 'sun'],
          ['txt', 'да'],
          ['abc', 2],
        ],
        ok: 2,
      },
      { type: 'train', stars: 1, say: 's', seq: ['1', '?2', '3'], extra: ['8'] },
      {
        type: 'nbr',
        stars: 1,
        say: 's',
        mid: '5',
        before: '4',
        after: '6',
        extra: [],
        labs: ['до', 'после'],
      },
      { type: 'word', stars: 3, say: 's', letters: ['Я', 'М', 'Ч'], word: 'МЯЧ', pic: 'ball' },
      {
        type: 'groups',
        stars: 2,
        say: 's',
        groups: [
          { lab: 'Полезно', color: '#2e9d55', keys: ['apple'] },
          { lab: 'Вредно', color: '#e53935', keys: ['chips'] },
        ],
      },
    ];
    for (const level of levels)
      expect(GameLevelSchema.safeParse(level).success, level.type).toBe(true);
  });

  it('rejects inconsistent levels', () => {
    expect(
      GameLevelSchema.safeParse({
        type: 'pick',
        stars: 1,
        say: 's',
        opts: [
          ['pic', 'a'],
          ['pic', 'b'],
        ],
        ok: 2,
      }).success,
    ).toBe(false);
    expect(
      GameLevelSchema.safeParse({ type: 'train', stars: 1, say: 's', seq: ['1', '2'], extra: [] })
        .success,
    ).toBe(false);
    expect(
      GameLevelSchema.safeParse({ type: 'word', stars: 1, say: 's', letters: ['А'], word: 'МЯЧ' })
        .success,
    ).toBe(false);
    expect(
      GameLevelSchema.safeParse({ type: 'story', stars: 4, say: 's', cards: ['a', 'b'] }).success,
    ).toBe(false);
  });
});
