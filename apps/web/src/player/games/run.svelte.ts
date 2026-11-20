import type { GameLevel, PickLevel } from '@sinf/shared';
import { shake } from '../lib/drag.js';
import { createGame, drop, type DropGame, type Tile } from '../lib/games.js';
import { beep } from '../lib/sounds.js';

/**
 * Reactive runner of a drag-and-drop level shared by story / groups / train / nbr / word components:
 * holds the game state, the tap-selected tile and the drop handling with sounds and shaking.
 */
export class DropRun {
  game = $state<DropGame>() as DropGame;
  selected = $state<string | null>(null);

  constructor(
    level: Exclude<GameLevel, PickLevel>,
    private readonly onDone: () => void,
  ) {
    const created = createGame(level);
    if (created.kind !== 'drop') throw new Error('not a drop level');
    this.game = created;
  }

  get tiles(): Tile[] {
    return this.game.tiles;
  }

  slot(id: string) {
    return this.game.slots.find((s) => s.id === id);
  }

  select(tileId: string): void {
    this.selected = this.selected === tileId ? null : tileId;
  }

  /** Drop from a drag gesture: the slot element carries `data-slot`. */
  dropOn(tileId: string, slotEl: HTMLElement, tileEl?: HTMLElement | null): void {
    const slotId = slotEl.dataset['slot'];
    if (!slotId) return;
    this.tryDrop(tileId, slotId, slotEl, tileEl);
  }

  /** Tap on a slot after a tile was tap-selected. */
  tapSlot(slotId: string, slotEl: HTMLElement): void {
    if (!this.selected) return;
    const tileId = this.selected;
    this.selected = null;
    const tileEl = slotEl
      .closest('.lesson-root')
      ?.querySelector<HTMLElement>(`[data-tile="${tileId}"]`);
    this.tryDrop(tileId, slotId, slotEl, tileEl);
  }

  private tryDrop(
    tileId: string,
    slotId: string,
    slotEl: HTMLElement,
    tileEl?: HTMLElement | null,
  ): void {
    const { result, game } = drop(this.game, tileId, slotId);
    if (result === 'ok') {
      this.game = game;
      this.selected = null;
      beep(true);
      if (game.done) this.onDone();
    } else if (result === 'wrong') {
      beep(false);
      shake(tileEl);
      shake(slotEl);
    }
  }
}

/** Keyboard fallback for tiles and slots: Enter or Space acts like a tap. */
export function isActivate(event: KeyboardEvent): boolean {
  return event.key === 'Enter' || event.key === ' ';
}
