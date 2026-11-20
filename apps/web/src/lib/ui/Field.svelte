<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * Label, control, hint and error as one piece, so forms on different pages stop drifting apart.
   * The label wraps the control, which associates them without hand-written ids.
   */
  let {
    label,
    hint,
    error,
    children,
  }: { label: string; hint?: string; error?: string | null; children: Snippet } = $props();
</script>

<label class="field" class:invalid={!!error}>
  <span class="label">{label}</span>
  {@render children()}
  {#if error}
    <span class="error">{error}</span>
  {:else if hint}
    <span class="hint">{hint}</span>
  {/if}
</label>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .label {
    font-weight: 600;
    color: var(--c-dark);
  }
  .hint,
  .error {
    font-size: var(--text-sm);
  }
  .hint {
    color: var(--c-muted);
  }
  .error {
    color: var(--c-danger-strong);
    font-weight: 600;
  }

  /* One look for every control inside a field, whoever writes the markup. */
  .field :global(input),
  .field :global(select),
  .field :global(textarea) {
    width: 100%;
    min-height: var(--control);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius);
    background: var(--c-surface);
    color: var(--c-dark);
  }
  .field :global(textarea) {
    min-height: calc(var(--control) * 2);
    line-height: var(--leading-normal);
    resize: vertical;
  }
  .field :global(input:hover),
  .field :global(select:hover),
  .field :global(textarea:hover) {
    border-color: var(--c-muted);
  }
  .invalid :global(input),
  .invalid :global(select),
  .invalid :global(textarea) {
    border-color: var(--c-danger);
  }
</style>
