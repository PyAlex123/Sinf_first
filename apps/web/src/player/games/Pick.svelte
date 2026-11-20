<script lang="ts">
  import type { Pics, PickLevel } from '@sinf/shared';
  import { shake } from '../lib/drag.js';
  import { createGame, pick, type PickGame } from '../lib/games.js';
  import { beep } from '../lib/sounds.js';
  import Letter from './Letter.svelte';

  let {
    level,
    pics,
    abc,
    abcColors,
    onDone,
  }: {
    level: PickLevel;
    pics: Pics;
    abc: readonly string[];
    abcColors: readonly string[];
    onDone: () => void;
  } = $props();

  // The level is fixed for the life of this component: LessonPlayer re-creates it per screen with {#key}.
  // svelte-ignore state_referenced_locally
  let game = $state(createGame(level) as PickGame);
  let chosen = $state<number | null>(null);

  function choose(i: number, el: HTMLElement): void {
    const r = pick(game, i);
    game = r.game;
    if (r.result === 'ok') {
      chosen = i;
      beep(true);
      onDone();
    } else {
      beep(false);
      shake(el);
    }
  }
</script>

<div class="row">
  {#each level.opts as opt, i (i)}
    {@const [kind, value] = opt}
    <button
      class="opt"
      class:txt={kind === 'txt'}
      class:abc={kind === 'abc'}
      type="button"
      style={chosen === i ? 'box-shadow:0 0 0 6px #2e9d55' : ''}
      disabled={game.done}
      onclick={(e) => choose(i, e.currentTarget)}
    >
      {#if kind === 'pic'}
        {@html pics[String(value)] ?? ''}
      {:else if kind === 'txt'}
        {value}
      {:else}
        <Letter value={abc[Number(value)] ?? '?'} {abc} {abcColors} />
      {/if}
    </button>
  {/each}
</div>
