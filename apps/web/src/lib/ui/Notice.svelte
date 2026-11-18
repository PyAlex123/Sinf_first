<script lang="ts">
  import type { Snippet } from 'svelte';

  /** A short message about what just happened. Colour carries the meaning, a bar carries the eye. */
  let { kind = 'info', children }: { kind?: 'info' | 'ok' | 'warn' | 'error'; children: Snippet } =
    $props();
</script>

<div class="notice {kind}" role={kind === 'error' ? 'alert' : 'status'}>{@render children()}</div>

<style>
  .notice {
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius);
    border: 1px solid var(--c-line);
    border-left: 4px solid var(--c-muted);
    background: var(--c-bg-2);
    color: var(--c-dark);
  }
  .info {
    border-left-color: var(--c-info);
    background: var(--c-info-soft);
  }
  .ok {
    border-left-color: var(--c-ok);
    background: var(--c-ok-soft);
  }
  .warn {
    border-left-color: var(--c-star);
    background: #fff4e5;
  }
  .error {
    border-left-color: var(--c-danger);
    background: var(--c-danger-soft);
    color: var(--c-danger-strong);
  }
</style>
