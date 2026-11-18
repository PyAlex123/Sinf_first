<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  /**
   * Nothing here yet. Says what this place is for and offers the one step that fills it, instead of
   * leaving a bare line of grey text.
   */
  let {
    icon,
    title,
    text,
    /**
     * Heading level, when this empty state is what the page is about — the teacher with no class
     * yet still needs an `h1`. `0` (the default) keeps it a plain line inside a section.
     */
    level = 0,
    children,
  }: {
    icon?: 'school' | 'student' | 'pc' | 'plus' | 'star';
    title: string;
    text?: string;
    level?: 0 | 1 | 2 | 3;
    children?: Snippet;
  } = $props();
</script>

<div class="empty">
  {#if icon}
    <span class="mark"><Icon name={icon} size={24} /></span>
  {/if}
  <svelte:element this={level === 0 ? 'p' : `h${level}`} class="title">{title}</svelte:element>
  {#if text}<p class="text">{text}</p>{/if}
  {#if children}<div class="action">{@render children()}</div>{/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-2);
    padding: var(--space-6) var(--space-4);
    border: 1px dashed var(--c-line-strong);
    border-radius: var(--radius-lg);
    background: var(--c-bg-2);
  }
  .mark {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: var(--radius-pill);
    background: var(--c-surface);
    color: var(--c-muted);
    border: 1px solid var(--c-line);
  }
  .title {
    margin: 0;
    text-align: center;
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--c-dark);
  }
  .text {
    margin: 0;
    max-width: 44ch;
    color: var(--c-muted);
  }
  .action {
    margin-top: var(--space-2);
  }
</style>
