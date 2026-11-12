<script lang="ts">
  import type { Snippet } from 'svelte';

  let { kind = 'info', children }: { kind?: 'info' | 'warn' | 'error'; children: Snippet } =
    $props();
</script>

<div class="notice {kind}" role={kind === 'error' ? 'alert' : 'status'}>{@render children()}</div>

<style>
  .notice {
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius);
    border: 1px solid var(--c-line);
    background: var(--c-bg-2);
    color: var(--c-dark);
  }
  .warn {
    background: #fff4e5;
    border-color: #f2c48d;
  }
  .error {
    background: #fdecea;
    border-color: #f3b4ae;
    color: var(--c-danger);
  }
</style>
