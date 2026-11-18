<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    children,
    padded = true,
    accent = false,
    muted = false,
  }: { children: Snippet; padded?: boolean; accent?: boolean; muted?: boolean } = $props();
</script>

<div class="card" class:padded class:accent class:muted>{@render children()}</div>

<style>
  .card {
    background: var(--c-surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    border: 1px solid var(--c-line);
  }
  .padded {
    padding: var(--space-5);
  }
  /* Something going on right now: a running lesson, a request waiting for an answer. */
  .accent {
    border-color: var(--c-accent);
    box-shadow: var(--shadow);
  }
  .muted {
    background: var(--c-bg-2);
    box-shadow: none;
  }
</style>
