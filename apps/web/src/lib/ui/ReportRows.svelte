<script lang="ts">
  import type { ReportRow } from '@sinf/shared';
  import { t } from '../i18n/index.svelte.js';
  import Table from './Table.svelte';

  /** Report rows (B1): a class or a parallel per row — lessons, attendance, grades, KTP. */
  let { rows, first }: { rows: ReportRow[]; first: string } = $props();

  const ktp = (r: ReportRow): string =>
    r.ktp ? `${r.ktp.done} / ${r.ktp.planned ?? '—'} / ${r.ktp.rows}` : '—';
</script>

<Table>
  <thead>
    <tr>
      <th>{first}</th>
      <th>{t('report.students')}</th>
      <th>{t('report.lessons')}</th>
      <th>{t('report.attendance')}</th>
      <th>{t('report.average')}</th>
      <th>5 / 4 / 3 / 2</th>
      <th title={t('report.ktpHint')}>{t('report.ktp')}</th>
    </tr>
  </thead>
  <tbody>
    {#each rows as r (r.classId ?? `grade-${r.grade}`)}
      <tr data-report-row={r.name}>
        <td><b>{r.classId ? r.name : t('report.parallel', { grade: r.grade })}</b></td>
        <td>{r.students}</td>
        <td>{r.lessons}</td>
        <td>{r.attendance === null ? '—' : `${r.attendance} %`}</td>
        <td><b>{r.average ?? '—'}</b></td>
        <td class="grades">{r.grades.five} / {r.grades.four} / {r.grades.three} / {r.grades.two}</td
        >
        <td class:behind={!!r.ktp && r.ktp.planned !== null && r.ktp.done < r.ktp.planned}
          >{ktp(r)}</td
        >
      </tr>
    {/each}
  </tbody>
</Table>

<style>
  .grades {
    white-space: nowrap;
  }
  .behind {
    color: var(--c-danger-strong);
    font-weight: 700;
  }
</style>
