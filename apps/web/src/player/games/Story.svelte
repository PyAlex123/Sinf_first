<script lang="ts">
  import type { Pics, StoryLevel } from '@sinf/shared';
  import { draggable } from '../lib/drag.js';
  import { DropRun, isActivate } from './run.svelte.js';

  let { level, pics, onDone }: { level: StoryLevel; pics: Pics; onDone: () => void } = $props();

  // The level is fixed for the life of this component: LessonPlayer re-creates it per screen with {#key}.
  // svelte-ignore state_referenced_locally
  const run = new DropRun(level, onDone);
</script>

<div class="row">
  {#each run.game.slots as slot (slot.id)}
    <div
      class="slot"
      class:filled={slot.filled.length > 0}
      data-slot={slot.id}
      data-full={slot.filled.length > 0}
      role="button"
      tabindex="0"
      onclick={(e) => run.tapSlot(slot.id, e.currentTarget)}
      onkeydown={(e) => isActivate(e) && run.tapSlot(slot.id, e.currentTarget)}
    >
      <div class="n">{slot.n}</div>
      {#each slot.filled as tile (tile.id)}
        <div class="card" style="cursor:default">{@html pics[tile.key] ?? ''}</div>
      {/each}
    </div>
  {/each}
</div>
<div class="row tray">
  {#each run.tiles as tile (tile.id)}
    <div
      class="card"
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
      {@html pics[tile.key] ?? ''}
    </div>
  {/each}
</div>
