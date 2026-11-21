<script lang="ts">
  import type { LibraryReport } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { t } from '../lib/i18n/index.svelte.js';
  import Button from '../lib/ui/Button.svelte';
  import Card from '../lib/ui/Card.svelte';

  /**
   * Reports about library items, for the superadmin (PLAN.md 3.9; W8): hide an item from the library,
   * or leave it there; either way the reports about it are closed.
   */
  let reports = $state<LibraryReport[]>([]);
  let error = $state(false);

  async function load(): Promise<void> {
    try {
      reports = (await api.libraryReports()).reports;
    } catch {
      error = true;
    }
  }

  async function moderate(r: LibraryReport, hidden: boolean): Promise<void> {
    try {
      await api.moderate(r.kind, r.itemId, hidden);
      await load();
    } catch {
      error = true;
    }
  }

  onMount(() => void load());
</script>

<Card>
  <h2>{t('library.reports')}</h2>
  {#if error}<p class="muted">{t('common.error')}</p>{/if}
  {#if reports.length === 0}
    <p class="muted">{t('library.noReports')}</p>
  {/if}
  <ul class="reports">
    {#each reports as r (r.id)}
      <li data-report={r.itemId}>
        <div>
          <b>{r.itemTitle}</b>
          <span class="muted small">
            · {t(`library.kind.${r.kind}`)} · {t('own.by', { name: r.ownerName })}
          </span>
        </div>
        <p>«{r.reason}» — {r.reporterName}</p>
        <div class="row">
          <Button size="sm" variant="danger" onclick={() => moderate(r, true)}
            >{t('library.hide')}</Button
          >
          <Button size="sm" variant="ghost" onclick={() => moderate(r, false)}
            >{t('library.keep')}</Button
          >
        </div>
      </li>
    {/each}
  </ul>
</Card>

<style>
  .reports {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }
  p {
    margin: var(--space-1) 0;
  }
  .row {
    display: flex;
    gap: var(--space-2);
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
</style>
