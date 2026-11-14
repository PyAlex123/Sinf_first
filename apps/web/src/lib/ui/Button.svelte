<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
  type Size = 'md' | 'lg' | 'xl';

  let {
    variant = 'primary',
    size = 'md',
    href,
    disabled = false,
    type = 'button',
    children,
    ...rest
  }: {
    variant?: Variant;
    size?: Size;
    href?: string;
    disabled?: boolean;
    children: Snippet;
  } & HTMLButtonAttributes = $props();
</script>

{#if href && !disabled}
  <a class="btn {variant} {size}" {href} role="button">{@render children()}</a>
{:else}
  <button class="btn {variant} {size}" {type} {disabled} {...rest}>{@render children()}</button>
{/if}

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: 44px;
    padding: 0 var(--space-4);
    border: 2px solid transparent;
    border-radius: var(--radius);
    font-weight: 600;
    text-decoration: none;
    line-height: 1.2;
    user-select: none;
    transition: background-color 0.1s;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .primary {
    background: var(--c-accent);
    color: #fff;
  }
  .primary:not(:disabled):hover {
    background: #933d0e;
  }
  .secondary {
    background: var(--c-surface);
    color: var(--c-dark);
    border-color: var(--c-line);
  }
  .secondary:not(:disabled):hover {
    background: var(--c-bg-2);
  }
  .danger {
    background: var(--c-danger);
    color: #fff;
  }
  .ghost {
    background: transparent;
    color: var(--c-accent);
  }
  .ghost:not(:disabled):hover {
    background: var(--c-bg-2);
  }
  .lg {
    min-height: var(--tap);
    font-size: var(--text-lg);
    padding: 0 var(--space-5);
  }
  .xl {
    min-height: 88px;
    font-size: var(--text-xl);
    padding: 0 var(--space-6);
    border-radius: var(--radius-lg);
  }
</style>
