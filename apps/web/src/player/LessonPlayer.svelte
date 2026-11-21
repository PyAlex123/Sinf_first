<script lang="ts">
  import type { Course, Lesson, Pics } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { mediaUrls, preload } from '../lib/content.js';
  import { t } from '../lib/i18n/index.svelte.js';
  import Game from './screens/Game.svelte';
  import Slide from './screens/Slide.svelte';
  import TypeWord from './screens/TypeWord.svelte';
  import Question from './screens/Question.svelte';
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
    range,
    frozen = false,
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
    /** Screens the viewer may walk through (the current stage in free mode, S1.9). */
    range?: { from: number; to: number } | null;
    /**
     * Something covers the lesson (the teacher's "Attention!" or the rest screen, S1.10). The curtain
     * stops the mouse by itself, but the keyboard listeners sit on `document`, so they are turned off
     * here too; otherwise the child pages through the lesson behind the curtain.
     */
    frozen?: boolean;
    onScreenDone?: (index: number, stars: number) => void;
    onNavigate?: (index: number) => void;
  } = $props();

  const count = $derived(lesson.screens.length);
  const first = $derived(range?.from ?? 0);
  const last = $derived(range?.to ?? count - 1);
  const screen = $derived(lesson.screens[index]);
  let win = $state<WinInfo | null>(null);
  let localDone = $state<number[]>([]);
  let localStars = $state(0);
  const allDone = $derived(new Set([...doneScreens, ...localDone]));
  const totalStars = $derived(stars + localStars);

  function go(next: number): void {
    const clamped = Math.max(first, Math.min(last, next));
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

  /** A test's answer (W4): counted like a trainer's, without the "well done" window. */
  function handleAnswer(stars: number): void {
    if (allDone.has(index)) return;
    localDone = [...localDone, index];
    localStars += stars;
    onScreenDone?.(index, stars);
  }

  function closeWin(): void {
    win = null;
    if (navigation === 'free') go(index + 1);
  }

  function onKey(event: KeyboardEvent): void {
    if (frozen || navigation !== 'free' || win) return;
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
      <div class="score" title={t('session.stars', { count: totalStars })}>★ {totalStars}</div>
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
            {frozen}
            done={allDone.has(index) && !win}
            onWin={(s: number) => handleWin({ stars: s })}
          />
        {:else if screen.kind === 'question'}
          <Question {screen} {frozen} done={allDone.has(index)} onAnswer={handleAnswer} />
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
      <button class="nb" type="button" disabled={index <= first} onclick={() => go(index - 1)}>
        ← {t('common.prev')}
      </button>
      <div class="sp"></div>
      <button class="nb go2" type="button" disabled={index >= last} onclick={() => go(index + 1)}>
        {index >= last ? t('player.done') : `${t('common.next')} →`}
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
    /* One font for the whole product; the lesson CSS asks for its own stack (ADR-010). */
    font-family: var(--font);
  }
  .ltitle {
    font-weight: 800;
    font-size: var(--text-lg);
    line-height: var(--leading-tight);
    color: var(--acc, #b04a12);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 46vw;
  }

  /*
   * The thin layer over the author's lesson CSS (ADR-010). `content/<course>/lesson.css` is written
   * by the import, so it is never edited there — the chrome around the lesson is brought into line
   * from here instead, while the slides themselves keep the author's own look.
   *
   * These selectors beat `.lesson-root .bar` because Svelte adds its scope class to `.lesson-root`.
   */
  .lesson-root :global(.bar) {
    height: auto;
    min-height: var(--control-lg);
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    background: var(--c-surface);
    border-bottom: 1px solid var(--c-line);
  }
  .lesson-root :global(.prog) {
    height: 8px;
    background: var(--c-bg-2);
    border-radius: var(--radius-pill);
  }
  .lesson-root :global(.count) {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--c-muted);
    font-variant-numeric: tabular-nums;
  }
  .lesson-root :global(.score) {
    font-size: var(--text-lg);
    color: var(--c-star-ink);
    font-variant-numeric: tabular-nums;
  }
  .lesson-root :global(.nav) {
    height: auto;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--c-surface);
    border-top: 1px solid var(--c-line);
  }
  /* The lesson's own buttons stay playful; only their size and corners are ours. */
  .lesson-root :global(.nb) {
    min-height: var(--tap);
    padding: 0 var(--space-5);
    border-radius: var(--radius-lg);
    font-size: var(--text-lg);
  }
  .lesson-root :global(.win .box) {
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    box-shadow: var(--shadow-lg);
  }
  /* A centred slide (no picture) keeps its points together: the list is centred, its lines are not. */
  .lesson-root :global(.slide.text.wide .s-list) {
    display: inline-block;
    text-align: left;
  }
  .lesson-root :global(.win .go) {
    min-height: var(--tap);
    border-radius: var(--radius-lg);
  }
</style>
