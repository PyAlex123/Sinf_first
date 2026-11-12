<script lang="ts">
  import type { Pics, Screen } from '@sinf/shared';
  import { t } from '../../lib/i18n/index.svelte.js';
  import Groups from '../games/Groups.svelte';
  import Nbr from '../games/Nbr.svelte';
  import Pick from '../games/Pick.svelte';
  import Story from '../games/Story.svelte';
  import Train from '../games/Train.svelte';
  import Word from '../games/Word.svelte';
  import { fitZoom } from '../lib/fit.js';
  import { speak } from '../lib/speech.js';
  import type { WinInfo } from '../lib/types.js';

  let {
    screen,
    pics,
    abc,
    abcColors,
    done = false,
    onWin,
  }: {
    screen: Extract<Screen, { kind: 'game' }>;
    pics: Pics;
    abc: readonly string[];
    abcColors: readonly string[];
    done?: boolean;
    onWin: (info: WinInfo) => void;
  } = $props();

  const level = $derived(screen.level);

  function finish(): void {
    const info: WinInfo = { stars: level.stars };
    if (level.pic) info.picKey = level.pic;
    if (level.done) info.message = level.done;
    onWin(info);
  }
</script>

<div class="fit">
  <div class="wrap" use:fitZoom>
    <div class="task">
      <button class="spk" type="button" title={t('player.speak')} onclick={() => speak(level.say)}
        >🔊</button
      >
      <span class="lv">{t('player.task', { n: screen.n })} {'★'.repeat(level.stars)}</span>
      <span>{level.say}</span>
    </div>

    {#if level.row}
      <div class="row">
        {#each level.row as cell, i (i)}
          <div
            class="cell"
            style={i === level.rowhl ? 'background:#ffeb3b;box-shadow:inset 0 0 0 4px #f2a516' : ''}
          >
            {cell}
          </div>
        {/each}
      </div>
    {/if}

    {#if level.show}
      <div class="show">
        {#if level.dir === 'before'}<span class="q">? →</span>{/if}
        {#each level.show as key (key)}
          <div class="card">{@html pics[key] ?? ''}</div>
        {/each}
        {#if level.dir !== 'before' && level.dir !== 'none'}<span class="q">→ ?</span>{/if}
      </div>
    {/if}

    {#if level.type === 'story'}
      <Story {level} {pics} onDone={finish} />
    {:else if level.type === 'groups'}
      <Groups {level} {pics} onDone={finish} />
    {:else if level.type === 'pick'}
      <Pick {level} {pics} {abc} {abcColors} onDone={finish} />
    {:else if level.type === 'train'}
      <Train {level} {abc} {abcColors} onDone={finish} />
    {:else if level.type === 'nbr'}
      <Nbr {level} {abc} {abcColors} onDone={finish} />
    {:else}
      <Word {level} {abc} {abcColors} onDone={finish} />
    {/if}

    {#if done}
      <div class="lay on">★ {t('player.done')}</div>
    {/if}
  </div>
</div>
