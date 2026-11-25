<script lang="ts">
  import type { Component } from 'svelte';
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { t } from '../lib/i18n/index.svelte.js';
  import type { PageProps } from '../lib/router.svelte.js';
  import Button from '../lib/ui/Button.svelte';
  import LangSwitch from '../lib/ui/LangSwitch.svelte';

  let { params: _params, query: _query }: PageProps = $props();

  /**
   * The front door. On the platform it is the landing page (PLAN.md 8.4; B10; ADR-026), loaded as
   * its own chunk. A classroom server — the teacher's computer — keeps the plain page with big
   * buttons: children in the room need the way in, not an advertisement. Until the server answers
   * nothing is drawn, so neither page flashes before the other.
   */
  let kind = $state<'platform' | 'classroom' | null>(null);
  let Landing = $state<Component | null>(null);

  onMount(() => {
    void api
      .site()
      .then(async (site) => {
        if (site.kind === 'platform') Landing = (await import('./Landing.svelte')).default;
        kind = site.kind;
      })
      .catch(() => (kind = 'classroom'));
  });
</script>

{#if kind === 'platform' && Landing}
  <Landing />
{:else if kind === 'classroom'}
  <main class="home">
    <div class="top"><LangSwitch /></div>
    <h1>{t('app.name')}</h1>
    <p class="sub">{t('home.subtitle')}</p>
    <div class="choice">
      <Button href="/join" size="xl">{t('home.student')}</Button>
      <Button href="/teacher" size="lg" variant="secondary">{t('home.teacher')}</Button>
      <Button href="/my" size="lg" variant="ghost">{t('home.myFiles')}</Button>
    </div>
  </main>
{/if}

<style>
  .home {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    text-align: center;
  }
  .top {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
  }
  h1 {
    font-size: var(--text-2xl);
  }
  .sub {
    color: var(--c-muted);
    margin-bottom: var(--space-6);
  }
  .choice {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: min(100%, 420px);
  }
  .choice :global(.btn) {
    width: 100%;
  }
</style>
