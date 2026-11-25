/** Something that can say whether it sits inside an element matching a CSS selector. */
interface Target {
  closest?: (selector: string) => unknown;
}

/**
 * Where the keys belong to what has the focus, not to the lesson (review 2026-11-25): text being
 * typed, and widgets that move with the arrows themselves. Buttons are not among them, so a
 * presentation clicker (PageDown) still turns the slide after the teacher clicked a button.
 */
const OWN_KEYS =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], ' +
  '[role="slider"], [role="menu"], [role="menubar"], [role="listbox"], [role="tablist"], ' +
  '[role="radiogroup"], [role="spinbutton"], [role="grid"]';

export function keysBelongToTarget(target: EventTarget | Target | null): boolean {
  const closest = (target as Target | null)?.closest;
  return typeof closest === 'function' && closest.call(target, OWN_KEYS) != null;
}

/** Arrow and page keys that should turn the lesson's slide: none of them while typing. */
export function turnsSlide(event: {
  defaultPrevented: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: EventTarget | Target | null;
}): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
  return !keysBelongToTarget(event.target);
}
