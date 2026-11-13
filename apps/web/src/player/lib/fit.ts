/**
 * Scales a task block to the stage, like the author's `fit()`: zoom between 0.7 and 1.7 so that a 1080×580 layout
 * fills the available area on small and large screens alike.
 *
 * Below 700 px the floor drops to 0.3: at 0.7 the 1080 px layout is wider than a phone, so part of the
 * cards and slots sit outside the stage and the task cannot be finished. Classroom screens keep 0.7.
 */
export function fitZoom(node: HTMLElement): { destroy(): void } {
  const stage = node.closest<HTMLElement>('.stage') ?? node.parentElement;
  const apply = (): void => {
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const floor = r.width < 700 ? 0.3 : 0.7;
    const zoom = Math.max(floor, Math.min(1.7, r.width / 1080, r.height / 580));
    node.style.zoom = String(zoom);
  };
  apply();
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
  if (stage && observer) observer.observe(stage);
  window.addEventListener('resize', apply);
  return {
    destroy() {
      observer?.disconnect();
      window.removeEventListener('resize', apply);
    },
  };
}
