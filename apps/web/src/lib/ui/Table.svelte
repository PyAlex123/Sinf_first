<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A list of rows that has to be read across: the class roster, a school's teachers, the room's
   * computers. The component only supplies alignment and lines; each page writes its own columns.
   *
   * Put the last column's controls in a cell with class="actions" to push them to the right edge.
   */
  let { children }: { children: Snippet } = $props();
</script>

<div class="wrap">
  <table>{@render children()}</table>
</div>

<style>
  .wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  .wrap :global(th) {
    text-align: left;
    font-size: var(--text-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--c-muted);
    padding: 0 var(--space-3) var(--space-2);
    border-bottom: 1px solid var(--c-line-strong);
    white-space: nowrap;
  }
  .wrap :global(td) {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--c-line);
    color: var(--c-dark);
    vertical-align: middle;
  }
  .wrap :global(tbody tr:last-child td) {
    border-bottom: none;
  }
  .wrap :global(th:first-child),
  .wrap :global(td:first-child) {
    padding-left: 0;
  }
  .wrap :global(th:last-child),
  .wrap :global(td:last-child) {
    padding-right: 0;
  }
  .wrap :global(.actions) {
    text-align: right;
    white-space: nowrap;
  }
  /* Flex belongs to a div inside the cell, never to the cell: a flex td drops out of its row. */
  .wrap :global(.actions > div) {
    display: inline-flex;
    gap: var(--space-2);
    align-items: center;
  }
  .wrap :global(.num) {
    color: var(--c-muted);
    width: 1%;
  }
</style>
