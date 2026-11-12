<script lang="ts">
  import type { NbrLevel } from '@sinf/shared';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { draggable } from '../lib/drag.js';
  import Letter from './Letter.svelte';
  import { DropRun, isActivate } from './run.svelte.js';

  let {
    level,
    abc,
    abcColors,
    onDone,
  }: {
    level: NbrLevel;
    abc: readonly string[];
    abcColors: readonly string[];
    onDone: () => void;
  } = $props();

  // The level is fixed for the life of this component: LessonPlayer re-creates it per screen with {#key}.
  // svelte-ignore state_referenced_locally
  const run = new DropRun(level, onDone);
  const colored = $derived(level.abc === true);
  const labels = $derived(level.labs ?? [t('player.before'), t('player.after')]);
</script>

<div class="nbr">
  {#each run.game.slots as slot, i (slot.id)}
    {#if i === 1}
      <div>
        <div class="lab">&nbsp;</div>
        <div class="cell mid"><Letter value={level.mid} {abc} {abcColors} {colored} /></div>
      </div>
    {/if}
    <div>
      <div class="lab">{labels[i]}</div>
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
