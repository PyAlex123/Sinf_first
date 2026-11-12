<script lang="ts">
  import type { Screen } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { shake } from '../lib/drag.js';
  import { fitZoom } from '../lib/fit.js';
  import { beep } from '../lib/sounds.js';
  import { speak } from '../lib/speech.js';
  import { charFromKey, checkWord } from '../lib/typing.js';

  let {
    screen,
    done = false,
    onWin,
  }: {
    screen: Extract<Screen, { kind: 'type' }>;
    done?: boolean;
    onWin: (stars: number) => void;
  } = $props();

  const letters = $derived([...screen.word]);
  let typed = $state<string[]>([]);
  let hint = $state(-1);
  let solved = $state(false);
  let layoutHint = $state(false);
  let result = $state<boolean[] | null>(null);
  let boxes = $state<HTMLDivElement | null>(null);
  let checkTimer: ReturnType<typeof setTimeout> | null = null;

  function check(): void {
    if (typed.length < letters.length) {
      shake(boxes);
      beep(false);
      return;
    }
    result = checkWord(typed, screen.word);
    if (result.every(Boolean)) {
      solved = true;
      beep(true);
      onWin(1);
    } else {
      shake(boxes);
      beep(false);
    }
  }

  function onKey(event: KeyboardEvent): void {
    if (solved || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === 'Backspace') {
      typed = typed.slice(0, -1);
      result = null;
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      check();
      event.preventDefault();
      return;
    }
    const got = charFromKey(event.key, event.code);
    if (!got) return;
    event.preventDefault();
    if (got.viaLayout) layoutHint = true;
    if (typed.length < letters.length) {
      typed = [...typed, got.ch];
      result = null;
      if (hint < typed.length) hint = -1;
      if (typed.length === letters.length) {
        if (checkTimer) clearTimeout(checkTimer);
        checkTimer = setTimeout(check, 250);
      }
    }
  }

  onMount(() => {
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (checkTimer) clearTimeout(checkTimer);
    };
  });
</script>

<div class="fit">
  <div class="wrap" use:fitZoom>
    <div class="task">
      <button
        class="spk"
        type="button"
        title={t('player.speak')}
        onclick={() => speak(screen.question)}>🔊</button
      >
      <span class="lv">{t('player.typeWord', { n: screen.n, of: screen.of })} ★</span>
      <span>{screen.question}</span>
    </div>
    <div class="tpic">{@html screen.pic}</div>
    <div class="tboxes" bind:this={boxes}>
      {#each letters as letter, i (i)}
        <div
          class="tbox"
          class:cur={i === typed.length && !solved}
          class:ok={result?.[i] === true}
          class:bad={result?.[i] === false}
        >
          {#if typed[i]}{typed[i]}{:else if i === hint}<span class="ph">{letter}</span>{/if}
        </div>
      {/each}
    </div>
    {#if done && !solved}
      <div class="lay on">★</div>
    {/if}
    <div class="keys">
      <span>{t('player.backspace')}</span>
      <span>{t('player.enter')}</span>
      <button class="hintb" type="button" onclick={() => (hint = typed.length)}
        >💡 {t('player.hint')}</button
      >
    </div>
    <div class="lay" class:on={layoutHint}>{t('player.layout')}</div>
  </div>
</div>
