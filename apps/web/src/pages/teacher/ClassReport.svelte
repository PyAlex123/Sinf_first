<script lang="ts">
  import { registerDate, type ClassReport } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { i18n, t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';
  import PeriodPicker from '../../lib/ui/PeriodPicker.svelte';
  import ReportRows from '../../lib/ui/ReportRows.svelte';
  import Table from '../../lib/ui/Table.svelte';

  /** A class's report (PLAN.md 8.2; stage 6, B1): the class over a period, and each child. */
  let { params }: PageProps = $props();
  const classId = $derived(params['id'] ?? '');
  let report = $state<ClassReport | null>(null);
  let from = $state('');
  let to = $state('');
  let error = $state<string | null>(null);

  const period = $derived({ ...(from ? { from } : {}), ...(to ? { to } : {}) });

  async function load(): Promise<void> {
    error = null;
    try {
      report = await api.classReport(classId, period);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.navigate('/teacher/login', { replace: true });
        return;
      }
      error =
        e instanceof ApiError && e.code === 'bad_period'
          ? t('report.badPeriod')
          : e instanceof ApiError && e.status === 404
            ? t('class.notFound')
            : t('common.error');
    }
  }

  onMount(() => void load());
</script>

<Header back={`/teacher/class/${classId}`} title={t('report.classTitle')} />

<main class="page stack">
  <PageHeader
    title={report ? t('report.classOf', { name: report.summary.name }) : t('report.classTitle')}
    subtitle={report
      ? t('report.period', { from: registerDate(report.from), to: registerDate(report.to) })
      : ''}
  >
    {#snippet actions()}
      {#if report}
        <Button
          variant="secondary"
          download
          href={api.classReportUrl(classId, period, i18n.locale)}
        >
          {t('report.export')}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>
  <Card><PeriodPicker bind:from bind:to onapply={() => void load()} /></Card>
  {#if error}<Notice kind="error">{error}</Notice>{/if}
  {#if report}
    <Card>
      <ReportRows rows={[report.summary]} first={t('report.class')} />
    </Card>
    <Card>
      <Table>
        <thead>
          <tr>
            <th>{t('results.col.student')}</th>
            <th>{t('report.present')}</th>
            <th>{t('report.average')}</th>
            <th>5 / 4 / 3 / 2</th>
          </tr>
        </thead>
        <tbody>
          {#each report.students as s (s.id)}
            <tr data-student={s.name}>
              <td>{s.name}</td>
              <td class:low={s.lessons > 0 && s.present / s.lessons < 0.75}
                >{s.present} / {s.lessons}</td
              >
              <td><b>{s.average ?? '—'}</b></td>
              <td>{s.grades.five} / {s.grades.four} / {s.grades.three} / {s.grades.two}</td>
            </tr>
          {/each}
        </tbody>
      </Table>
      <p class="muted small">{t('report.lowHint')}</p>
    </Card>
  {/if}
</main>

<style>
  .low {
    color: var(--c-danger-strong);
    font-weight: 700;
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
</style>
