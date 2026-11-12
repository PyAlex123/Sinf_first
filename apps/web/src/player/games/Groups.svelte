<script lang="ts">
  import type { GroupsLevel, Pics } from '@sinf/shared';
  import { draggable } from '../lib/drag.js';
  import { DropRun, isActivate } from './run.svelte.js';

  let { level, pics, onDone }: { level: GroupsLevel; pics: Pics; onDone: () => void } = $props();

  // The level is fixed for the life of this component: LessonPlayer re-creates it per screen with {#key}.
  // svelte-ignore state_referenced_locally
  const run = new DropRun(level, onDone);
</script>

<div class="row">
  {#each run.game.slots as bin (bin.id)}
    <div
      class="bin"
      style="--bc:{bin.color}"
      data-slot={bin.id}
      role="button"
      tabindex="0"
      onclick={(e) => run.tapSlot(bin.id, e.currentTarget)}
      onkeydown={(e) => isActivate(e) && run.tapSlot(bin.id, e.currentTarget)}
    >
      <div class="bl">{bin.label}</div>
      <div class="bc">
        {#each bin.filled as tile (tile.id)}
          <div class="mini">{@html pics[tile.key] ?? ''}</div>
        {/each}
      </div>
    </div>
  {/each}
</div>
<div class="row tray">
  {#each run.tiles as tile (tile.id)}
    <div
      class="card sm"
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
