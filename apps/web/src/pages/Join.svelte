<script lang="ts">
  import type { JoinClass } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { t } from '../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../lib/router.svelte.js';
  import Button from '../lib/ui/Button.svelte';
  import LangSwitch from '../lib/ui/LangSwitch.svelte';
  import Notice from '../lib/ui/Notice.svelte';

  let { params: _params }: PageProps = $props();
  const CLASS_KEY = 'sinf.join.class';
  const POLL_MS = 4000;

  let classes = $state<JoinClass[]>([]);
  let chosen = $state<string | null>(null);
  let error = $state<string | null>(null);
  let loaded = $state(false);

  const current = $derived(classes.find((c) => c.id === chosen) ?? null);

  async function refresh(): Promise<void> {
    try {
      classes = (await api.joinClasses()).classes;
      error = null;
      loaded = true;
      if (chosen && current?.activeSession) enter();
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.error');
    }
  }

  function choose(id: string): void {
    chosen = id;
    try {
      localStorage.setItem(CLASS_KEY, id);
    } catch {
      // ignore
    }
    if (current?.activeSession) enter();
  }

  function enter(): void {
    const session = current?.activeSession;
    if (session) router.navigate(`/s/${session.id}`);
  }

  onMount(() => {
    try {
      chosen = localStorage.getItem(CLASS_KEY);
    } catch {
      chosen = null;
    }
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  });
</script>

<main class="join">
  <div class="top"><a class="home" href="/">{t('app.name')}</a><LangSwitch /></div>
  <h1>{t('join.title')}</h1>
  {#if error}
    <Notice kind="error">{error}</Notice>
  {:else if !loaded}
    <p aria-busy="true">{t('common.loading')}</p>
  {:else if classes.length === 0}
    <Notice>{t('join.classes.none')}</Notice>
  {:else}
    <div class="classes">
      {#each classes as c (c.id)}
        <button
          type="button"
          class="cls"
          class:chosen={c.id === chosen}
          class:live={!!c.activeSession}
          onclick={() => choose(c.id)}
        >
          <span class="grade">{t('join.grade', { grade: c.grade })}</span>
          <span class="name">{c.name}</span>
          {#if c.activeSession}<span class="live-dot" aria-hidden="true"></span>{/if}
        </button>
      {/each}
    </div>
    {#if current}
      <div class="status">
        {#if current.activeSession}
          <p class="lesson">{t('join.lesson', { title: current.activeSession.lessonTitle })}</p>
          <Button size="xl" onclick={enter}>{t('join.enter')}</Button>
        {:else}
          <Notice>{t('join.waiting')}</Notice>
        {/if}
      </div>
    {/if}
  {/if}
</main>

<style>
  .join {
    min-height: 100vh;
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .top {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-5);
  }
  .home {
    font-weight: 800;
    color: var(--c-dark);
    text-decoration: none;
    font-size: var(--text-lg);
  }
  h1 {
    font-size: var(--text-2xl);
  }
  .classes {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
  }
  .cls {
    position: relative;
    min-width: 160px;
    min-height: 120px;
    border: 3px solid var(--c-line);
    border-radius: var(--radius-lg);
    background: var(--c-surface);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    box-shadow: var(--shadow);
  }
  .cls.chosen {
    border-color: var(--c-accent);
  }
  .grade {
    font-size: var(--text-xl);
    font-weight: 800;
    color: var(--c-dark);
  }
  .name {
    color: var(--c-muted);
    font-weight: 600;
  }
  .live-dot {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--c-ok);
  }
  .status {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    width: min(100%, 480px);
  }
  .lesson {
    font-size: var(--text-lg);
    color: var(--c-dark);
    font-weight: 600;
  }
</style>
