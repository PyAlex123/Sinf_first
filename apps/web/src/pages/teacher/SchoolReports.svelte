<script lang="ts">
  import { registerDate, type SchoolReport } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { i18n, t } from '../../lib/i18n/index.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import PeriodPicker from '../../lib/ui/PeriodPicker.svelte';
  import ReportRows from '../../lib/ui/ReportRows.svelte';

  /** The school's report (PLAN.md 8.2; stage 6, B1): its classes and parallels over a period. */
  let { schoolId }: { schoolId: string } = $props();
  let report = $state<SchoolReport | null>(null);
  let from = $state('');
  let to = $state('');
  let error = $state<string | null>(null);

  const period = $derived({ ...(from ? { from } : {}), ...(to ? { to } : {}) });

  async function load(): Promise<void> {
    error = null;
    try {
      report = await api.schoolReport(schoolId, period);
    } catch (e) {
      error =
        e instanceof ApiError && e.code === 'bad_period'
          ? t('report.badPeriod')
          : e instanceof ApiError && e.code === 'license_needed'
            ? t('license.reports')
            : t('common.error');
    }
  }

  onMount(() => void load());
</script>

<Card>
  <div class="head">
    <h2>{t('report.schoolTitle')}</h2>
    {#if report}
      <Button
        size="sm"
        variant="secondary"
        download
        href={api.schoolReportUrl(schoolId, period, i18n.locale)}>{t('report.export')}</Button
      >
    {/if}
  </div>
  <PeriodPicker bind:from bind:to onapply={() => void load()} />
  {#if error}<Notice kind="error">{error}</Notice>{/if}
  {#if report}
    <p class="muted small" data-period>
      {t('report.period', { from: registerDate(report.from), to: registerDate(report.to) })}
    </p>
    {#if report.classes.length === 0}
      <p class="muted">{t('school.noClasses')}</p>
    {:else}
      <h3>{t('report.byClass')}</h3>
      <ReportRows rows={report.classes} first={t('report.class')} />
      <h3>{t('report.byParallel')}</h3>
      <ReportRows rows={report.parallels} first={t('report.parallelHead')} />
      <p class="muted small">{t('report.ktpHint')}</p>
    {/if}
  {/if}
</Card>

<style>
  .head {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    margin-bottom: var(--space-3);
  }
  h2 {
    margin: 0;
  }
  h3 {
    margin: var(--space-4) 0 var(--space-2);
    font-size: var(--text-md);
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
</style>
