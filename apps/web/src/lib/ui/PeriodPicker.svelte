<script lang="ts">
  import { t } from '../i18n/index.svelte.js';
  import Button from './Button.svelte';

  /**
   * The period of a report (B1): the school year so far by default, or two dates. Empty dates
   * mean "the school year so far" — the server knows which one it is.
   */
  let {
    from = $bindable(''),
    to = $bindable(''),
    onapply,
  }: { from?: string; to?: string; onapply: () => void } = $props();
</script>

<form
  class="period"
  onsubmit={(e) => {
    e.preventDefault();
    onapply();
  }}
>
  <label>
    <span>{t('report.from')}</span>
    <input type="date" bind:value={from} data-field="report-from" />
  </label>
  <label>
    <span>{t('report.to')}</span>
    <input type="date" bind:value={to} data-field="report-to" />
  </label>
  <Button type="submit" size="sm">{t('report.show')}</Button>
  <Button
    size="sm"
    variant="ghost"
    onclick={() => {
      from = '';
      to = '';
      onapply();
    }}>{t('report.year')}</Button
  >
</form>

<style>
  .period {
    display: flex;
    gap: var(--space-3);
    align-items: end;
    flex-wrap: wrap;
  }
  label {
    display: grid;
    gap: var(--space-1);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  input {
    min-height: var(--control-sm);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius);
    background: var(--c-surface);
    color: var(--c-dark);
  }
</style>
