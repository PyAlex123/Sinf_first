<script lang="ts">
  /**
   * The icon set of the platform: hand-drawn paths, no icon library (CLAUDE.md §3.1 — a dependency
   * has to earn its weight, and sixteen paths cost about two kilobytes).
   *
   * An icon never carries meaning alone. Either a word stands next to it, or the control around it
   * has an aria-label; the icon itself is hidden from screen readers.
   */
  type Name =
    | 'back'
    | 'forward'
    | 'play'
    | 'pause'
    | 'plus'
    | 'print'
    | 'pc'
    | 'school'
    | 'student'
    | 'lock'
    | 'unlock'
    | 'hand'
    | 'close'
    | 'check'
    | 'star'
    | 'clock'
    | 'skip'
    | 'screen';

  let { name, size = 20 }: { name: Name; size?: number } = $props();

  const paths: Record<Name, string> = {
    back: 'M15 5l-7 7 7 7',
    forward: 'M9 5l7 7-7 7',
    play: 'M8 5l11 7-11 7z',
    pause: 'M9 5v14M15 5v14',
    plus: 'M12 5v14M5 12h14',
    print: 'M7 9V4h10v5M7 18H5v-6h14v6h-2M7 14h10v6H7z',
    pc: 'M3 5h18v11H3zM9 20h6M12 16v4',
    school: 'M3 10l9-5 9 5v10H3zM9 20v-6h6v6',
    student: 'M12 4a4 4 0 110 8 4 4 0 010-8zM4 21a8 8 0 0116 0',
    lock: 'M6 11h12v9H6zM9 11V8a3 3 0 016 0v3',
    unlock: 'M6 11h12v9H6zM9 11V8a3 3 0 015.6-1.5',
    hand: 'M8 13V5a1.5 1.5 0 013 0v6m0-2a1.5 1.5 0 013 0v2m0-1a1.5 1.5 0 013 0v5a6 6 0 01-6 6h-1a6 6 0 01-6-6v-2',
    close: 'M6 6l12 12M18 6L6 18',
    check: 'M5 13l4 4 10-10',
    star: 'M12 4l2.4 5 5.6.7-4 3.9 1 5.4-5-2.7-5 2.7 1-5.4-4-3.9 5.6-.7z',
    clock: 'M12 3a9 9 0 110 18 9 9 0 010-18zM12 7v5l4 2',
    skip: 'M6 5l8 7-8 7zM17 5v14',
    screen: 'M3 5h18v11H3zM8 20h8',
  };
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"><path d={paths[name]} /></svg
>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
