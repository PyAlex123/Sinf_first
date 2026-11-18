<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * One band of controls. The lesson panel had three stacked bands competing for attention; this is
   * the one band: what matters now on the left, the controls in the middle, the mode on the right.
   */
  let { lead, children, trail }: { lead?: Snippet; children?: Snippet; trail?: Snippet } = $props();
</script>

<div class="toolbar">
  {#if lead}<div class="lead">{@render lead()}</div>{/if}
  {#if children}<div class="main">{@render children()}</div>{/if}
  {#if trail}<div class="trail">{@render trail()}</div>{/if}
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
    padding: var(--space-3) var(--space-4);
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
  }
  .lead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .main,
  .trail {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .main {
    flex: 1 1 auto;
  }
  .trail {
    margin-left: auto;
  }
</style>
