<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n/index.svelte.js';
  import LangSwitch from './LangSwitch.svelte';

  let {
    title,
    back,
    children,
    lang = true,
  }: { title?: string; back?: string; children?: Snippet; lang?: boolean } = $props();
</script>

<header class="bar">
  <div class="left">
    {#if back}
      <a class="back" href={back} aria-label={t('common.back')}>←</a>
    {/if}
    <a class="brand" href="/">{t('app.name')}</a>
    {#if title}
      <span class="title">{title}</span>
    {/if}
  </div>
  <div class="right">
    {#if children}{@render children()}{/if}
    {#if lang}<LangSwitch />{/if}
  </div>
</header>

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    background: var(--c-surface);
    border-bottom: 1px solid var(--c-line);
    min-height: 56px;
  }
  .left,
  .right {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }
  .brand {
    font-weight: 800;
    color: var(--c-dark);
    text-decoration: none;
    font-size: var(--text-lg);
  }
  .back {
    text-decoration: none;
    font-size: var(--text-lg);
    color: var(--c-dark);
    padding: 0 var(--space-2);
  }
  .title {
    color: var(--c-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
