<script lang="ts">
  import type { TrainLevel } from '@sinf/shared';
  import { draggable } from '../lib/drag.js';
  import Letter from './Letter.svelte';
  import { DropRun, isActivate } from './run.svelte.js';

  let {
    level,
    abc,
    abcColors,
    onDone,
  }: {
    level: TrainLevel;
    abc: readonly string[];
    abcColors: readonly string[];
    onDone: () => void;
  } = $props();

  // The level is fixed for the life of this component: LessonPlayer re-creates it per screen with {#key}.
  // svelte-ignore state_referenced_locally
  const run = new DropRun(level, onDone);
  const colored = $derived(level.abc === true);
</script>

<div class="train">
  <svg class="loco" viewBox="0 0 120 110" aria-hidden="true">
    <rect x="10" y="30" width="80" height="58" rx="8" fill="#e53935" />
    <rect x="58" y="6" width="40" height="40" rx="6" fill="#1e63d6" />
    <rect x="18" y="12" width="16" height="22" fill="#455a64" />
    <circle cx="32" cy="96" r="12" fill="#455a64" />
    <circle cx="74" cy="96" r="12" fill="#455a64" />
    <path d="M90 70 L112 84 L90 84 Z" fill="#fdd835" />
  </svg>
  {#each run.game.train ?? [] as item, i (i)}
    <div class="wag">
      {#if item.kind === 'cell'}
        <div class="cell"><Letter value={item.value} {abc} {abcColors} {colored} /></div>
      {:else}
        {@const slot = run.slot(item.slotId)}
        {#if slot}
          <div
            class="gap"
            class:filled={slot.filled.length > 0}
            data-slot={slot.id}
            data-full={slot.filled.length > 0}
            role="button"
            tabindex="0"
            onclick={(e) => run.tapSlot(slot.id, e.currentTarget)}
            onkeydown={(e) => isActivate(e) && run.tapSlot(slot.id, e.currentTarget)}
          >
            {#if slot.filled[0]}<Letter
                value={slot.filled[0].key}
                {abc}
                {abcColors}
                {colored}
              />{/if}
          </div>
        {/if}
      {/if}
    </div>
  {/each}
</div>
<div class="row tray">
  {#each run.tiles as tile (tile.id)}
    <div
      class="tile"
      class:sel={run.selected === tile.id}
      data-tile={tile.id}
      role="button"
      tabindex="0"
      use:draggable={{
        onDrop: (slotEl) => run.dropOn(tile.id, slotEl),
        onSelect: () => run.select(tile.id),
      }}
      onkeydown={(e) => isActivate(e) && run.select(tile.id)}
    >
      <Letter value={tile.key} {abc} {abcColors} {colored} />
    </div>
  {/each}
</div>
