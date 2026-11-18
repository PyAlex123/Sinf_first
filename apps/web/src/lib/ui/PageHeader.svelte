<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * The top of a page: where am I, what is this, what can I do here. Every section uses the same
   * one, so the answer is always in the same place.
   */
  let { title, subtitle, actions }: { title: string; subtitle?: string; actions?: Snippet } =
    $props();
</script>

<div class="head">
  <div class="text">
    <h1>{title}</h1>
    {#if subtitle}<p class="sub">{subtitle}</p>{/if}
  </div>
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .text {
    min-width: 0;
  }
  h1 {
    margin: 0;
  }
  .sub {
    margin: var(--space-1) 0 0;
    color: var(--c-muted);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
</style>
