/**
 * Pointer-based dragging of a tile onto `[data-slot]` targets (mouse and touch), ported from the author's
 * `makeDrag`: a ghost copy follows the pointer, the slot under it is highlighted with `.hot`, a tap without
 * movement selects the tile (then a tap on a slot drops it).
 */

export interface DragOptions {
  /** Drop on a slot element. */
  onDrop: (slot: HTMLElement) => void;
  /** Tap without dragging. */
  onSelect: () => void;
  disabled?: boolean;
}

const MOVE_THRESHOLD_PX = 6;

export function draggable(
  node: HTMLElement,
  options: DragOptions,
): { update(o: DragOptions): void; destroy(): void } {
  let current = options;

  const onPointerDown = (event: PointerEvent): void => {
    if (current.disabled || event.button !== 0) return;
    event.preventDefault();
    const rect = node.getBoundingClientRect();
    const ghost = node.cloneNode(true) as HTMLElement;
    ghost.classList.add('drag');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    (node.closest('.lesson-root') ?? document.body).appendChild(ghost);
    const dx = event.clientX - rect.left;
    const dy = event.clientY - rect.top;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    let hot: HTMLElement | null = null;

    const slotAt = (x: number, y: number): HTMLElement | null => {
      const el = document.elementFromPoint(x, y);
      const slot = el?.closest<HTMLElement>('[data-slot]') ?? null;
      return slot && slot.dataset['full'] !== 'true' ? slot : null;
    };

    const move = (ev: PointerEvent): void => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > MOVE_THRESHOLD_PX) {
        moved = true;
      }
      ghost.style.left = `${ev.clientX - dx}px`;
      ghost.style.top = `${ev.clientY - dy}px`;
      node.style.opacity = moved ? '.35' : '1';
      const slot = slotAt(ev.clientX, ev.clientY);
      if (hot && hot !== slot) hot.classList.remove('hot');
      if (slot) slot.classList.add('hot');
      hot = slot;
    };

    const up = (ev: PointerEvent): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      ghost.remove();
      node.style.opacity = '1';
      hot?.classList.remove('hot');
      if (!moved) {
        current.onSelect();
        return;
      }
      const slot = slotAt(ev.clientX, ev.clientY);
      if (slot) current.onDrop(slot);
    };

    move(event);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  };

  node.addEventListener('pointerdown', onPointerDown);
  return {
    update(o) {
      current = o;
    },
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
    },
  };
}

/** Shakes an element (wrong answer), re-triggering the CSS animation. */
export function shake(el: Element | null | undefined): void {
  if (!el) return;
  el.classList.remove('shake');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('shake');
}
