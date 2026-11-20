<script lang="ts">
  import { QUIZ_OPTION_LETTERS, type Pics, type QuizOption } from '@sinf/shared';

  /**
   * One answer of the live quiz (S1.12). The same tile is used on the projector and in the child's
   * hand, so a first grader matches them by colour and by letter without reading a word.
   */
  let {
    option,
    index,
    pics,
    state = 'idle',
    big = false,
    onclick,
  }: {
    option: QuizOption;
    index: number;
    pics: Pics;
    /** `chosen` — the child pressed it; after the answer: `correct`, `wrong`, `dim`. */
    state?: 'idle' | 'chosen' | 'correct' | 'wrong' | 'dim';
    /** The projector and the child's screen use the same tile at two sizes. */
    big?: boolean;
    /** Missing on the projector, where the tiles are only shown; present in the child's hand. */
    onclick?: (() => void) | undefined;
  } = $props();

  const letter = $derived(QUIZ_OPTION_LETTERS[index] ?? '?');
</script>

<svelte:element
  this={onclick ? 'button' : 'div'}
  class="opt c{index} {state}"
  class:big
  type={onclick ? 'button' : undefined}
  role={onclick ? 'button' : undefined}
  disabled={onclick && state !== 'idle' ? true : undefined}
  {onclick}
>
  <span class="letter">{letter}</span>
  <span class="face">
    {#if option.pic}
      {@html pics[option.pic] ?? ''}
    {:else}
      <b>{option.text}</b>
    {/if}
  </span>
</svelte:element>

<style>
  .opt {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: var(--tap);
    padding: var(--space-2);
    border: 3px solid transparent;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    color: #fff;
    overflow: hidden;
  }
  .big {
    min-height: 140px;
  }
  /* Four colours a child can call by name, the same on both screens. */
  .c0 {
    background: #d64545;
  }
  .c1 {
    background: #2f6fd0;
  }
  .c2 {
    background: #c98306;
  }
  .c3 {
    background: #2e8b57;
  }
  .letter {
    position: absolute;
    top: var(--space-1);
    left: var(--space-2);
    font-weight: 900;
    font-size: var(--text-lg);
    opacity: 0.9;
  }
  .face {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    min-height: 72px;
  }
  .face :global(svg) {
    width: 100%;
    height: 100%;
    max-height: 180px;
    display: block;
  }
  .face b {
    font-size: var(--text-3xl);
    font-weight: 900;
  }
  .big .face b {
    font-size: 72px;
  }
  .chosen {
    border-color: #fff;
    box-shadow: var(--shadow-lg);
  }
  /* After the answer: the right one steps forward, the rest step back. */
  .correct {
    border-color: #fff;
    box-shadow: 0 0 0 6px var(--c-ok);
  }
  .wrong {
    opacity: 0.55;
    filter: grayscale(0.5);
  }
  .dim {
    opacity: 0.35;
    filter: grayscale(0.7);
  }
</style>
