import type { GameLevel, PickLevel } from '@sinf/shared';

/**
 * Pure logic of the six trainer level types (STAGE1.md §2.1), ported from the author's file.
 * Components render `GameRun` and call `drop` / `pick`; nothing here touches the DOM.
 */

export type Rng = () => number;

/** Fisher–Yates; with `keep` the result must differ from the input (up to 30 attempts), as in the original. */
export function shuffle<T>(items: readonly T[], keep = false, rng: Rng = Math.random): T[] {
  const result = [...items];
  for (let attempt = 0; attempt < 30; attempt++) {
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const a = result[i] as T;
      result[i] = result[j] as T;
      result[j] = a;
    }
    if (!keep || result.join() !== items.join()) break;
  }
  return result;
}

export interface Tile {
  id: string;
  /** Value the tile carries: a PICS key, a letter or a number. */
  key: string;
}

export interface Slot {
  id: string;
  /** Keys this slot accepts. */
  accepts: readonly string[];
  /** How many tiles fit; `null` — unlimited (group bins). */
  capacity: number | null;
  filled: Tile[];
  /** Badge number (story) or label (nbr). */
  n?: number;
  label?: string;
  color?: string;
}

/** Row item of a train level: a fixed wagon or a gap to fill. */
export type TrainItem = { kind: 'cell'; value: string } | { kind: 'slot'; slotId: string };

export interface DropGame {
  kind: 'drop';
  level: Exclude<GameLevel, PickLevel>;
  slots: Slot[];
  tiles: Tile[];
  /** Tiles still to place. */
  left: number;
  done: boolean;
  /** Only for `train`: the wagon row in order. */
  train?: TrainItem[];
}

export interface PickGame {
  kind: 'pick';
  level: PickLevel;
  done: boolean;
  wrong: number;
}

export type GameRun = DropGame | PickGame;
export type DropResult = 'ok' | 'wrong' | 'full' | 'missing';

export function createGame(level: GameLevel, rng: Rng = Math.random): GameRun {
  switch (level.type) {
    case 'pick':
      return { kind: 'pick', level, done: false, wrong: 0 };
    case 'story': {
      const slots = level.cards.map((card, i) => slot(`s${i}`, [card], 1, { n: i + 1 }));
      const tiles = shuffle(level.cards, true, rng).map(tile);
      return { kind: 'drop', level, slots, tiles, left: slots.length, done: false };
    }
    case 'groups': {
      const slots = level.groups.map((g, i) =>
        slot(`g${i}`, g.keys, null, { label: g.lab, color: g.color }),
      );
      const all = level.groups.flatMap((g) => g.keys);
      const tiles = shuffle(all, false, rng).map(tile);
      return { kind: 'drop', level, slots, tiles, left: all.length, done: false };
    }
    case 'train': {
      const slots: Slot[] = [];
      const wanted: string[] = [];
      const train: TrainItem[] = level.seq.map((v) => {
        if (v.startsWith('?')) {
          const want = v.slice(1);
          const s = slot(`s${slots.length}`, [want], 1);
          slots.push(s);
          wanted.push(want);
          return { kind: 'slot', slotId: s.id };
        }
        return { kind: 'cell', value: v };
      });
      const tiles = shuffle([...wanted, ...level.extra], false, rng).map(tile);
      return { kind: 'drop', level, slots, tiles, left: slots.length, done: false, train };
    }
    case 'nbr': {
      const [beforeLabel, afterLabel] = level.labs ?? ['', ''];
      const slots = [
        slot('before', [level.before], 1, { label: beforeLabel }),
        slot('after', [level.after], 1, { label: afterLabel }),
      ];
      const tiles = shuffle([level.before, level.after, ...level.extra], false, rng).map(tile);
      return { kind: 'drop', level, slots, tiles, left: 2, done: false };
    }
    case 'word': {
      const slots = [...level.word].map((ch, i) => slot(`s${i}`, [ch], 1));
      // The author shows the letters in the given order (they are already mixed in the data).
      const tiles = level.letters.map(tile);
      return { kind: 'drop', level, slots, tiles, left: slots.length, done: false };
    }
  }
}

/** Tries to put a tile into a slot. Returns the outcome and the next state (unchanged unless `ok`). */
export function drop(
  game: DropGame,
  tileId: string,
  slotId: string,
): { result: DropResult; game: DropGame } {
  const tile = game.tiles.find((t) => t.id === tileId);
  const target = game.slots.find((s) => s.id === slotId);
  if (!tile || !target || game.done) return { result: 'missing', game };
  if (target.capacity !== null && target.filled.length >= target.capacity) {
    return { result: 'full', game };
  }
  if (!target.accepts.includes(tile.key)) return { result: 'wrong', game };
  const slots = game.slots.map((s) =>
    s.id === slotId ? { ...s, filled: [...s.filled, tile] } : s,
  );
  const tiles = game.tiles.filter((t) => t.id !== tileId);
  const left = game.left - 1;
  return { result: 'ok', game: { ...game, slots, tiles, left, done: left === 0 } };
}

export function pick(
  game: PickGame,
  optionIndex: number,
): { result: 'ok' | 'wrong'; game: PickGame } {
  if (game.done) return { result: 'wrong', game };
  if (optionIndex === game.level.ok) return { result: 'ok', game: { ...game, done: true } };
  return { result: 'wrong', game: { ...game, wrong: game.wrong + 1 } };
}

let tileSeq = 0;
function tile(key: string): Tile {
  tileSeq += 1;
  return { id: `t${tileSeq}`, key };
}

function slot(
  id: string,
  accepts: readonly string[],
  capacity: number | null,
  extra: Partial<Pick<Slot, 'n' | 'label' | 'color'>> = {},
): Slot {
  return { id, accepts, capacity, filled: [], ...extra };
}
