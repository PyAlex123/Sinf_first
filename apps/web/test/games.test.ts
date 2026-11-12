import { describe, expect, it } from 'vitest';
import type { GameLevel } from '@sinf/shared';
import { createGame, drop, pick, shuffle, type DropGame } from '../src/player/lib/games.js';

/** Deterministic rng: always picks the last index, so shuffle keeps the order unless `keep` forces a change. */
const fixed = (): number => 0.999;

/** Plays a drop level by always choosing a correct tile for each slot; returns the final state. */
function solve(game: DropGame): DropGame {
  let g = game;
  for (const slot of g.slots) {
    const wanted = slot.capacity === null ? slot.accepts.length : slot.capacity;
    for (let i = 0; i < wanted; i++) {
      const tile = g.tiles.find((t) => slot.accepts.includes(t.key));
      if (!tile) throw new Error(`no tile for ${slot.id}`);
      const r = drop(g, tile.id, slot.id);
      expect(r.result).toBe('ok');
      g = r.game;
    }
  }
  return g;
}

const levels: Record<string, GameLevel> = {
  story: { type: 'story', stars: 1, say: 's', cards: ['sun', 'rain', 'rainbow'] },
  groups: {
    type: 'groups',
    stars: 2,
    say: 's',
    groups: [
      { lab: 'A', color: '#0f0', keys: ['apple', 'walk'] },
      { lab: 'B', color: '#f00', keys: ['chips'] },
    ],
  },
  train: { type: 'train', stars: 1, say: 's', seq: ['1', '2', '?3', '4', '?5', '6'], extra: ['8'] },
  nbr: { type: 'nbr', stars: 1, say: 's', mid: '5', before: '4', after: '6', extra: ['3', '7'] },
  word: { type: 'word', stars: 3, say: 's', letters: ['Я', 'М', 'Ч'], word: 'МЯЧ', pic: 'ball' },
};

describe('shuffle', () => {
  it('returns a permutation and, with keep, a different order', () => {
    const items = ['a', 'b', 'c', 'd'];
    const once = shuffle(items);
    expect([...once].sort()).toEqual(items);
    let seed = 1;
    const rng = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    expect(shuffle(items, true, rng)).not.toEqual(items);
  });
});

describe('drop levels', () => {
  it.each(Object.entries(levels))('%s: can be solved and rejects wrong drops', (_name, level) => {
    const game = createGame(level, fixed);
    if (game.kind !== 'drop') throw new Error('expected a drop game');
    expect(game.done).toBe(false);
    expect(game.left).toBeGreaterThan(0);

    const first = game.slots[0];
    const wrong = game.tiles.find((t) => first && !first.accepts.includes(t.key));
    if (wrong && first) {
      const r = drop(game, wrong.id, first.id);
      expect(r.result).toBe('wrong');
      expect(r.game).toBe(game);
    }
    const solved = solve(game);
    expect(solved.done).toBe(true);
    expect(solved.left).toBe(0);
  });

  it('story slots take one card each and keep the badge numbers', () => {
    const game = createGame(levels['story'] as GameLevel, fixed) as DropGame;
    expect(game.slots.map((s) => s.n)).toEqual([1, 2, 3]);
    const sun = game.tiles.find((t) => t.key === 'sun');
    const slot0 = game.slots[0];
    if (!sun || !slot0) throw new Error('setup');
    const g2 = drop(game, sun.id, slot0.id).game;
    const rain = g2.tiles.find((t) => t.key === 'rain');
    if (!rain) throw new Error('setup');
    expect(drop(g2, rain.id, slot0.id).result).toBe('full');
    expect(drop(g2, 'nope', slot0.id).result).toBe('missing');
  });

  it('train builds the wagon row with gaps in place and extra distractors in the tray', () => {
    const game = createGame(levels['train'] as GameLevel, fixed) as DropGame;
    expect(game.train?.map((i) => (i.kind === 'cell' ? i.value : '_'))).toEqual([
      '1',
      '2',
      '_',
      '4',
      '_',
      '6',
    ]);
    expect(game.tiles.map((t) => t.key).sort()).toEqual(['3', '5', '8']);
  });

  it('groups count every picture and accept any picture of the group', () => {
    const game = createGame(levels['groups'] as GameLevel, fixed) as DropGame;
    expect(game.left).toBe(3);
    expect(game.slots[0]?.capacity).toBeNull();
  });
});

describe('pick', () => {
  it('counts wrong answers and finishes on the right one', () => {
    const level: GameLevel = {
      type: 'pick',
      stars: 1,
      say: 's',
      opts: [
        ['pic', 'a'],
        ['txt', 'b'],
      ],
      ok: 1,
    };
    const game = createGame(level);
    if (game.kind !== 'pick') throw new Error('expected pick');
    const wrong = pick(game, 0);
    expect(wrong.result).toBe('wrong');
    expect(wrong.game.wrong).toBe(1);
    const right = pick(wrong.game, 1);
    expect(right.result).toBe('ok');
    expect(right.game.done).toBe(true);
    expect(pick(right.game, 1).result).toBe('wrong');
  });
});
