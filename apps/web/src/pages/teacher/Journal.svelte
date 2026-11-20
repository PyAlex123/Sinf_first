<script lang="ts">
  import { registerDate, type Journal, type JournalCell } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { i18n, t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import EmptyState from '../../lib/ui/EmptyState.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Badge from '../../lib/ui/Badge.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';

  /**
   * The class journal (S1.13): children down in register order, lessons across. A cell holds the
   * lesson's stars — or its 2–5 grade, when the class has grades — or the absence mark. A date
   * opens that lesson's results. The same table goes to Excel, made on the server.
   */

  let { params }: PageProps = $props();
  const classId = $derived(params['classId'] ?? '');

  let journal = $state<Journal | null>(null);
  let error = $state<string | null>(null);

  /** `05.11`: the year is the same across one journal, so the column stays narrow. */
  const shortDate = (date: string): string => registerDate(date).slice(0, 5);

  function cellText(cell: JournalCell): string {
    if (!cell.present) return t('journal.absent');
    return cell.grade !== null ? String(cell.grade) : `★ ${cell.stars}`;
  }

  onMount(() => {
    void (async () => {
      try {
        journal = await api.journal(classId);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.navigate('/teacher/login', { replace: true });
          return;
        }
        error = e instanceof ApiError && e.status === 404 ? t('class.notFound') : t('common.error');
      }
    })();
  });
</script>

<Header back="/teacher" />

<main class="page stack">
  {#if error}
    <Notice kind="error">{error}</Notice>
  {:else if !journal}
    <p aria-busy="true" class="muted">{t('common.loading')}</p>
  {:else}
    <PageHeader
      title={t('journal.title', { name: journal.class.name })}
      subtitle={t('journal.count', { count: journal.lessons.length })}
    >
      {#snippet actions()}
        <Button variant="secondary" href={`/teacher/class/${journal?.class.id}`}>
          {t('class.manage')}
        </Button>
        <Button
          href={api.journalExportUrl(classId, i18n.locale)}
          download
          disabled={journal?.lessons.length === 0}
        >
          {t('journal.export')}
        </Button>
      {/snippet}
    </PageHeader>

    {#if journal.lessons.length === 0}
      <EmptyState icon="star" title={t('journal.empty.title')} text={t('journal.empty')} />
    {:else}
      <Card>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th class="num sticky">№</th>
                <th class="who sticky">{t('results.col.student')}</th>
                {#each journal.lessons as lesson (lesson.sessionId)}
                  <th class="day">
                    <a
                      href={`/teacher/session/${lesson.sessionId}/results`}
                      title={`${registerDate(lesson.date)} · ${lesson.lessonTitle}`}
                    >
                      {shortDate(lesson.date)}
                    </a>
                    <span class="topic">{lesson.lessonTitle}</span>
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each journal.students as student, i (student.id)}
                <tr class:left={!student.isActive}>
                  <td class="num sticky">{i + 1}</td>
                  <td class="who sticky">
                    {student.name}
                    {#if student.isVirtual}<Badge tone="info">{t('virtual.short')}</Badge>{/if}
                    {#if !student.isActive}<span class="muted small">({t('journal.left')})</span
                      >{/if}
                  </td>
                  {#each student.cells as cell, c (journal.lessons[c]?.sessionId)}
                    <td
                      class="cell"
                      class:absent={cell && !cell.present}
                      class:grade={cell?.present && cell.grade !== null}
                    >
                      {cell ? cellText(cell) : ''}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="muted small legend">
          {journal.class.starsToGrade ? t('journal.legend.grades') : t('journal.legend.stars')}
        </p>
      </Card>
    {/if}
  {/if}
</main>

<style>
  /* A year of lessons is wider than any screen: the names stay, the dates scroll. */
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: separate;
    border-spacing: 0;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--c-line);
    white-space: nowrap;
  }
  th {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--c-muted);
    text-align: left;
    vertical-align: bottom;
    border-bottom-color: var(--c-line-strong);
  }
  .sticky {
    position: sticky;
    background: var(--c-surface);
    z-index: 1;
  }
  /* Fixed width, so the name column knows where to stick. */
  .num {
    left: 0;
    box-sizing: border-box;
    width: 3em;
    min-width: 3em;
    max-width: 3em;
    color: var(--c-muted);
  }
  .who {
    left: 3em;
    min-width: 14em;
    font-weight: 600;
    border-right: 1px solid var(--c-line);
  }
  .day {
    text-align: center;
    min-width: 5em;
  }
  .day a {
    display: block;
    color: var(--c-accent);
    font-size: var(--text-md);
  }
  .topic {
    display: block;
    max-width: 8em;
    margin: 0 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 400;
  }
  .cell {
    text-align: center;
    color: var(--c-dark);
  }
  .cell.absent {
    color: var(--c-danger);
  }
  /* Bold, not bigger: every row keeps one height, so the eye runs along it. */
  .cell.grade {
    font-weight: 700;
  }
  .left .who {
    font-weight: 400;
    color: var(--c-muted);
  }
  tbody tr:last-child td {
    border-bottom: none;
  }
  .legend {
    margin: var(--space-4) 0 0;
  }
</style>
