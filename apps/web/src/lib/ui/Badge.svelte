<script lang="ts">
  import type { Snippet } from 'svelte';

  /** A one-word state next to a name: administrator, waiting, online, not studying. */
  let {
    tone = 'neutral',
    children,
  }: { tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info'; children: Snippet } =
    $props();
</script>

<span class="badge {tone}">{@render children()}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 2px var(--space-2);
    border-radius: var(--radius-pill);
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1.4;
    white-space: nowrap;
  }
  .neutral {
    background: var(--c-bg-2);
    color: var(--c-muted);
  }
  .accent {
    background: var(--c-accent-soft);
    color: var(--c-accent-strong);
  }
  .ok {
    background: var(--c-ok-soft);
    color: var(--c-ok);
  }
  .warn {
    background: #fff4e5;
    color: #8a5a00;
  }
  .danger {
    background: var(--c-danger-soft);
    color: var(--c-danger-strong);
  }
  .info {
    background: var(--c-info-soft);
    color: var(--c-info);
  }
</style>
