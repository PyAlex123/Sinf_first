<script lang="ts">
  import type { LessonSummary } from '@sinf/shared';
  import { onMount } from 'svelte';
  import LessonPlayer from '../player/LessonPlayer.svelte';
  import { loadBundle, loadCourse, type DemoBundle } from './demo-content.js';
  import { SHOTS } from './shots.js';

  /** Standalone showcase: a really playable lesson plus pictures of the parts that need a server. */
  type Tab = 'lesson' | 'teacher';

  let tab = $state<Tab>('lesson');
  let lessons = $state<LessonSummary[]>([]);
  let lessonId = $state('g10');
  let bundle = $state<DemoBundle | null>(null);
  let error = $state<string | null>(null);
  let index = $state(0);
  let openShot = $state<string | null>(null);

  async function open(id: string): Promise<void> {
    lessonId = id;
    bundle = null;
    index = 0;
    try {
      bundle = await loadBundle(id);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Не удалось загрузить урок';
    }
  }

  onMount(() => {
    void (async () => {
      try {
        const course = await loadCourse();
        lessons = course.lessons.filter((l) => l.id === 'g10' || l.id === 'k10');
        await open('g10');
      } catch (e) {
        error = e instanceof Error ? e.message : 'Не удалось загрузить урок';
      }
    })();
  });
</script>

<div class="demo">
  <header class="bar">
    <div class="brand">
      <strong>Sinf</strong>
      <span>демо · 1 класс, II четверть</span>
    </div>
    <nav class="tabs">
      <button type="button" class:on={tab === 'lesson'} onclick={() => (tab = 'lesson')}
        >Урок</button
      >
      <button type="button" class:on={tab === 'teacher'} onclick={() => (tab = 'teacher')}>
        У учителя
      </button>
    </nav>
  </header>

  {#if tab === 'lesson'}
    <div class="picker">
      {#each lessons as l (l.id)}
        <button type="button" class:on={l.id === lessonId} onclick={() => open(l.id)}>
          <span class="icon">{@html l.icon}</span>
          <span class="meta">
            <b>Урок {l.num}. {l.title}</b>
            <small
              >{l.group === 'krujok' ? 'Кружок · Paint' : 'Госпрограмма'} · {l.screens} экранов</small
            >
          </span>
        </button>
      {/each}
    </div>

    <p class="tip">
      Это настоящий урок, а не картинки: листайте кнопками, перетаскивайте карточки пальцем<span
        class="long">, печатайте слово на клавиатуре. Кнопка 🔊 читает задание вслух</span
      >.
    </p>

    <div class="stagebox">
      {#if error}
        <p class="err">{error}</p>
      {:else if bundle}
        {#key lessonId}
          <LessonPlayer
            lesson={bundle.lesson}
            course={bundle.course}
            pics={bundle.pics}
            bind:index
          />
        {/key}
      {:else}
        <p class="load">Загружаем урок…</p>
      {/if}
    </div>
  {:else}
    <div class="gallery">
      <p class="tip">
        Эти экраны работают только с сервером, поэтому здесь они картинками. Снято с живой программы
        во время проверки.
      </p>
      {#each SHOTS as shot (shot.file)}
        <figure>
          <button type="button" onclick={() => (openShot = shot.file)}>
            <img src={`shots/${shot.file}`} alt={shot.title} loading="lazy" />
          </button>
          <figcaption>
            <b>{shot.title}</b>
            {shot.text}
          </figcaption>
        </figure>
      {/each}
    </div>
  {/if}

  {#if openShot}
    <button type="button" class="lightbox" onclick={() => (openShot = null)} aria-label="Закрыть">
      <img src={`shots/${openShot}`} alt="" />
    </button>
  {/if}
</div>

<style>
  .demo {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--c-bg);
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--c-surface);
    border-bottom: 1px solid var(--c-line);
    flex-wrap: wrap;
  }
  .brand strong {
    color: var(--c-dark);
    font-size: var(--text-lg);
    margin-right: var(--space-2);
  }
  .brand span {
    color: var(--c-muted);
    font-size: var(--text-sm);
  }
  .tabs {
    display: inline-flex;
    border: 1px solid var(--c-line);
    border-radius: 999px;
    overflow: hidden;
  }
  .tabs button {
    border: 0;
    background: transparent;
    padding: var(--space-2) var(--space-4);
    min-height: 40px;
    color: var(--c-muted);
    font-weight: 600;
  }
  .tabs .on {
    background: var(--c-dark);
    color: #fff;
  }
  .picker {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-3) 0;
    flex-wrap: wrap;
  }
  .picker button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    border: 2px solid var(--c-line);
    border-radius: var(--radius-lg);
    background: var(--c-surface);
    padding: var(--space-2);
    text-align: left;
    flex: 1 1 260px;
  }
  .picker .on {
    border-color: var(--c-accent);
  }
  .picker .icon :global(svg) {
    width: 64px;
    height: 48px;
    border-radius: 8px;
    display: block;
  }
  .meta b {
    display: block;
    color: var(--c-dark);
    font-size: var(--text-md);
    line-height: 1.2;
  }
  .meta small {
    color: var(--c-muted);
  }
  .tip {
    margin: var(--space-3);
    padding: var(--space-3);
    background: var(--c-bg-2);
    border-radius: var(--radius);
    color: var(--c-text);
    font-size: var(--text-sm);
  }
  /* The player fills the box: `.lesson-root` is `height: 100%`, which needs a definite height here,
     otherwise the stage collapses to 0 and the task cards are clipped away (invisible and unclickable). */
  .stagebox {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 70vh;
    margin: 0 var(--space-3) var(--space-3);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: #fff;
    position: relative;
  }
  .stagebox > :global(.lesson-root) {
    flex: 1;
    min-height: 0;
  }
  .load,
  .err {
    padding: var(--space-5);
    text-align: center;
    color: var(--c-muted);
  }
  .err {
    color: var(--c-danger);
  }
  .gallery {
    padding: 0 var(--space-3) var(--space-5);
    display: grid;
    gap: var(--space-4);
  }
  .gallery figure {
    margin: 0;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .gallery figure > button {
    display: block;
    width: 100%;
    border: 0;
    padding: 0;
    background: none;
  }
  .gallery img {
    width: 100%;
    height: auto;
    display: block;
  }
  figcaption {
    padding: var(--space-3);
    font-size: var(--text-sm);
    color: var(--c-muted);
  }
  figcaption b {
    display: block;
    color: var(--c-dark);
    font-size: var(--text-md);
    margin-bottom: 2px;
  }
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 100;
    border: 0;
    padding: var(--space-3);
    background: rgba(19, 35, 58, 0.92);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .lightbox img {
    max-width: 100%;
    max-height: 100%;
    border-radius: var(--radius);
  }
  @media (min-width: 900px) {
    .gallery {
      grid-template-columns: 1fr 1fr;
    }
  }
  /* Phone: the page itself must not scroll, otherwise the player's navigation ends up below the fold
     and the lesson cannot be paged through with the thumb. The gallery tab keeps its own scrolling. */
  @media (max-width: 700px) {
    .demo {
      height: 100dvh;
      min-height: 0;
      overflow: hidden;
    }
    .picker {
      padding: var(--space-2) var(--space-2) 0;
    }
    .picker button {
      flex: 1 1 150px;
      padding: var(--space-1);
      gap: var(--space-1);
    }
    .picker .icon :global(svg) {
      width: 40px;
      height: 30px;
    }
    .meta b {
      font-size: var(--text-sm);
    }
    .meta small {
      display: none;
    }
    .long {
      display: none;
    }
    .tip {
      margin: var(--space-2);
      padding: var(--space-2);
      font-size: 12px;
    }
    .stagebox {
      min-height: 0;
      margin: 0 var(--space-2) var(--space-2);
    }
    .gallery {
      overflow: auto;
      flex: 1;
      min-height: 0;
    }
  }
</style>
