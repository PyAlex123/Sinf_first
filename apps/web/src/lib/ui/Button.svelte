<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  /**
   * One button for the whole platform (ADR-010). The variant says how loud the action is, so a page
   * reads at a glance: one `primary`, `secondary` for the usual, `ghost` for the quiet ones and
   * `danger` for what cannot be taken back — removing a child, unpairing a computer.
   */
  type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
  type Size = 'sm' | 'md' | 'lg' | 'xl';

  let {
    variant = 'primary',
    size = 'md',
    href,
    disabled = false,
    block = false,
    type = 'button',
    children,
    ...rest
  }: {
    variant?: Variant;
    size?: Size;
    href?: string;
    disabled?: boolean;
    /** Fills the width of its container: forms on a phone, the student's big buttons. */
    block?: boolean;
    children: Snippet;
  } & HTMLButtonAttributes = $props();
</script>

{#if href && !disabled}
  <a class="btn {variant} {size}" class:block {href} role="button">{@render children()}</a>
{:else}
  <button class="btn {variant} {size}" class:block {type} {disabled} {...rest}>
    {@render children()}
  </button>
{/if}

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: var(--control);
    padding: 0 var(--space-4);
    border: 1px solid transparent;
    border-radius: var(--radius);
    font-weight: 600;
    text-decoration: none;
    line-height: var(--leading-tight);
    white-space: nowrap;
    user-select: none;
    transition:
      background-color 0.12s,
      border-color 0.12s,
      color 0.12s;
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .sm {
    min-height: var(--control-sm);
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
  }
  .lg {
    min-height: var(--control-lg);
    padding: 0 var(--space-5);
    font-size: var(--text-lg);
  }
  .xl {
    min-height: var(--tap);
    padding: 0 var(--space-6);
    font-size: var(--text-lg);
    border-radius: var(--radius-lg);
  }

  .primary {
    background: var(--c-accent);
    color: #fff;
  }
  .primary:not(:disabled):hover {
    background: var(--c-accent-strong);
  }

  .secondary {
    background: var(--c-surface);
    color: var(--c-dark);
    border-color: var(--c-line-strong);
  }
  .secondary:not(:disabled):hover {
    background: var(--c-bg-2);
    border-color: var(--c-muted);
  }

  /* The quiet one: it must not compete with the accent, so it carries no colour of its own. */
  .ghost {
    background: transparent;
    color: var(--c-muted);
  }
  .ghost:not(:disabled):hover {
    background: var(--c-bg-2);
    color: var(--c-dark);
  }

  .danger {
    background: var(--c-danger);
    color: #fff;
  }
  .danger:not(:disabled):hover {
    background: var(--c-danger-strong);
  }

  /* Deleting is not a routine action, so it never looks like one. */
  .danger-ghost {
    background: transparent;
    color: var(--c-danger);
  }
  .danger-ghost:not(:disabled):hover {
    background: var(--c-danger-soft);
  }

  .block {
    width: 100%;
  }
</style>
