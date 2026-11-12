<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    children,
    padded = true,
    accent = false,
  }: { children: Snippet; padded?: boolean; accent?: boolean } = $props();
</script>

<div class="card" class:padded class:accent>{@render children()}</div>

<style>
  .card {
    background: var(--c-surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    border: 1px solid var(--c-line);
  }
  .padded {
    padding: var(--space-4);
  }
  .accent {
    border-color: var(--c-accent-dark);
  }
</style>
