<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n/index.svelte.js';
  import Icon from './Icon.svelte';
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
      <a class="back" href={back} aria-label={t('common.back')}><Icon name="back" /></a>
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
    min-height: var(--control-lg);
  }
  .left,
  .right {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    min-height: var(--control-sm);
    font-weight: 800;
    color: var(--c-dark);
    text-decoration: none;
    font-size: var(--text-lg);
  }
  .back {
    display: grid;
    place-items: center;
    width: var(--control-sm);
    height: var(--control-sm);
    border-radius: var(--radius);
    color: var(--c-dark);
    text-decoration: none;
    flex: none;
  }
  .back:hover {
    background: var(--c-bg-2);
  }
  .title {
    color: var(--c-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* The brand and the page title read as one line: "Sinf · Урок 10". */
  .title::before {
    content: '·';
    margin-right: var(--space-2);
    color: var(--c-line-strong);
  }
</style>
