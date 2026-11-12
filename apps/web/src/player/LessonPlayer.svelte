<script lang="ts">
  import type { Course, Lesson, Pics } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { mediaUrls, preload } from '../lib/content.js';
  import { t } from '../lib/i18n/index.svelte.js';
  import Game from './screens/Game.svelte';
  import Slide from './screens/Slide.svelte';
  import TypeWord from './screens/TypeWord.svelte';
  import type { WinInfo } from './lib/types.js';
  import WinDialog from './WinDialog.svelte';

  let {
    lesson,
    course,
    pics,
    index = $bindable(0),
    navigation = 'free',
    header = true,
    doneScreens = [],
    stars = 0,
    onScreenDone,
    onNavigate,
  }: {
    lesson: Lesson;
    course: Course;
    pics: Pics;
    /** Current screen. */
    index?: number;
    /** `free`: the viewer moves with buttons and arrow keys; `locked`: the index is set from outside. */
    navigation?: 'free' | 'locked';
    header?: boolean;
    /** Screens already rewarded (stars are given once per screen). */
    doneScreens?: readonly number[];
    stars?: number;
    onScreenDone?: (index: number, stars: number) => void;
    onNavigate?: (index: number) => void;
  } = $props();

  const count = $derived(lesson.screens.length);
  const screen = $derived(lesson.screens[index]);
  let win = $state<WinInfo | null>(null);
  let localDone = $state<number[]>([]);
  let localStars = $state(0);
  const allDone = $derived(new Set([...doneScreens, ...localDone]));
  const totalStars = $derived(stars + localStars);

  function go(next: number): void {
    const clamped = Math.max(0, Math.min(count - 1, next));
    if (clamped === index) return;
    win = null;
    index = clamped;
    onNavigate?.(clamped);
  }

  function handleWin(info: WinInfo): void {
    if (!allDone.has(index)) {
      localDone = [...localDone, index];
      localStars += info.stars;
      onScreenDone?.(index, info.stars);
    }
    win = info;
  }

  function closeWin(): void {
    win = null;
    if (navigation === 'free') go(index + 1);
  }

  function onKey(event: KeyboardEvent): void {
    if (navigation !== 'free' || win) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') go(index + 1);
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') go(index - 1);
  }

  $effect(() => {
    const next = lesson.screens[index + 1];
    if (next && (next.kind === 'slide' || next.kind === 'step')) preload(mediaUrls(next.html));
  });

  onMount(() => {
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
</script>

<div class="lesson-root">
  <!-- Shared SVG definitions (gradients, patterns) referenced by slides via url(#id). -->
  <svg width="0" height="0" style="position:absolute" aria-hidden="true">{@html course.svgDefs}</svg
  >

  {#if header}
    <header class="bar">
      <span class="ltitle">{lesson.title}</span>
      <div class="prog"><i style="width:{((index + 1) / count) * 100}%"></i></div>
      <div class="count">{t('player.screen', { index: index + 1, count })}</div>
      <div class="score">★ {totalStars}</div>
    </header>
  {/if}

  <main class="stage">
    {#if screen}
      {#key index}
        {#if screen.kind === 'slide' || screen.kind === 'step'}
          <Slide {screen} />
        {:else if screen.kind === 'type'}
          <TypeWord
            {screen}
            done={allDone.has(index) && !win}
            onWin={(s: number) => handleWin({ stars: s })}
          />
        {:else}
          <Game
            {screen}
            {pics}
            abc={course.abc}
            abcColors={course.abcColors}
            done={allDone.has(index) && !win}
            onWin={handleWin}
          />
        {/if}
      {/key}
    {/if}
  </main>

  {#if navigation === 'free'}
    <footer class="nav">
      <button class="nb" type="button" disabled={index === 0} onclick={() => go(index - 1)}>
        ← {t('common.prev')}
      </button>
      <div class="sp"></div>
      <button
        class="nb go2"
        type="button"
        disabled={index >= count - 1}
        onclick={() => go(index + 1)}
      >
        {index >= count - 1 ? t('player.done') : `${t('common.next')} →`}
      </button>
    </footer>
  {/if}

  {#if win}
    <WinDialog info={win} {pics} onClose={closeWin} />
  {/if}
</div>

<style>
  .lesson-root {
    height: 100%;
    min-height: 0;
  }
  .ltitle {
    font-weight: 800;
    font-size: 20px;
    color: var(--acc, #ff6a00);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 46vw;
  }
</style>
