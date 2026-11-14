<script lang="ts">
  import type { WordLevel } from '@sinf/shared';
  import { draggable } from '../lib/drag.js';
  import Letter from './Letter.svelte';
  import { DropRun, isActivate } from './run.svelte.js';

  let {
    level,
    abc,
    abcColors,
    onDone,
  }: {
    level: WordLevel;
    abc: readonly string[];
    abcColors: readonly string[];
    onDone: () => void;
  } = $props();

  // The level is fixed for the life of this component: LessonPlayer re-creates it per screen with {#key}.
  // svelte-ignore state_referenced_locally
  const run = new DropRun(level, onDone);
  const colored = $derived(level.abc === true);
</script>

<div class="row">
  {#each run.game.slots as slot (slot.id)}
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
      {#if slot.filled[0]}<Letter value={slot.filled[0].key} {abc} {abcColors} {colored} />{/if}
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
