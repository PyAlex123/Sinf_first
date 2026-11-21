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
   * The class journal (S1.13, W9): children down in register order, lessons across, and the
   * teacher's own columns without a lesson. A cell holds the lesson's stars — or its 2–5 grade —
   * or the absence mark. A date opens that lesson's results. The same table goes to Excel.
   *
   * By hand, from the keyboard (PLAN.md 5.1): click a cell, type 2–5; "н" marks absent in a column
   * without a lesson; Backspace clears; arrows and Enter move; "к" (or "c") writes a note.
   */

  let { params }: PageProps = $props();
  const classId = $derived(params['classId'] ?? '');

  let journal = $state<Journal | null>(null);
  let error = $state<string | null>(null);
  let adding = $state(false);
  let newDate = $state(new Date().toISOString().slice(0, 10));
  let newTitle = $state('');
  let saving = $state(false);

  type Lesson = Journal['lessons'][number];
  const columnKey = (l: Lesson): string => l.sessionId ?? l.columnId ?? '';
  const columnRef = (l: Lesson) =>
    l.kind === 'lesson'
      ? { kind: 'lesson' as const, sessionId: l.sessionId ?? '' }
      : { kind: 'manual' as const, columnId: l.columnId ?? '' };

  async function addColumn(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!newTitle.trim()) return;
    try {
      journal = await api.addJournalColumn(classId, newDate, newTitle.trim());
      newTitle = '';
      adding = false;
    } catch {
      error = t('common.error');
    }
  }

  async function removeColumn(l: Lesson): Promise<void> {
    if (!l.columnId || !confirm(t('journal.column.deleteConfirm', { title: l.lessonTitle })))
      return;
    try {
      journal = await api.deleteJournalColumn(classId, l.columnId);
    } catch {
      error = t('common.error');
    }
  }

  async function setCell(
    studentId: string,
    l: Lesson,
    change: { value?: number | null; absent?: boolean; comment?: string | null },
  ): Promise<void> {
    if (saving) return;
    saving = true;
    error = null;
    try {
      journal = await api.setJournalCell(classId, { column: columnRef(l), studentId, ...change });
    } catch (e) {
      error =
        e instanceof ApiError && e.code === 'lesson_running'
          ? t('journal.running')
          : e instanceof ApiError && e.code === 'not_at_lesson'
            ? t('journal.notThere')
            : t('common.error');
    } finally {
      saving = false;
    }
  }

  /** The keyboard of a cell: 2–5, "н", Backspace, a note, and the arrows. */
  function onCellKey(event: KeyboardEvent, row: number, col: number): void {
    if (!journal) return;
    const student = journal.students[row];
    const l = journal.lessons[col];
    if (!student || !l) return;
    const key = event.key.toLowerCase();
    if (/^[2-5]$/.test(key)) {
      event.preventDefault();
      void setCell(student.id, l, { value: Number(key) });
      focusCell(row + 1, col);
    } else if ((key === 'н' || key === 'n' || key === 'y') && l.kind === 'manual') {
      event.preventDefault();
      void setCell(student.id, l, { absent: true });
      focusCell(row + 1, col);
    } else if (key === 'backspace' || key === 'delete') {
      event.preventDefault();
      void setCell(
        student.id,
        l,
        l.kind === 'manual' ? { value: null, absent: false } : { value: null },
      );
    } else if (key === 'к' || key === 'c') {
      event.preventDefault();
      note(student.id, l, student.cells[col]?.comment ?? '');
    } else if (key === 'arrowdown' || key === 'enter') {
      event.preventDefault();
      focusCell(row + 1, col);
    } else if (key === 'arrowup') {
      event.preventDefault();
      focusCell(row - 1, col);
    } else if (key === 'arrowright') {
      event.preventDefault();
      focusCell(row, col + 1);
    } else if (key === 'arrowleft') {
      event.preventDefault();
      focusCell(row, col - 1);
    }
  }

  function note(studentId: string, l: Lesson, current: string): void {
    const text = prompt(t('journal.note'), current);
    if (text === null) return;
    void setCell(studentId, l, { comment: text.trim() || null });
  }

  function focusCell(row: number, col: number): void {
    const el = document.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`);
    el?.focus();
  }

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
        <Button variant="secondary" onclick={() => (adding = !adding)}
          >{t('journal.column.add')}</Button
        >
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

    {#if adding}
      <Card>
        <form class="addcol" onsubmit={addColumn}>
          <label>
            <span>{t('journal.column.date')}</span>
            <input type="date" bind:value={newDate} required data-field="column-date" />
          </label>
          <label class="wide">
            <span>{t('journal.column.title')}</span>
            <input
              bind:value={newTitle}
              maxlength="60"
              required
              placeholder={t('journal.column.example')}
              data-field="column-title"
            />
          </label>
          <Button type="submit">{t('journal.column.create')}</Button>
        </form>
      </Card>
    {/if}
    {#if journal.lessons.length > 0}<p class="muted small">{t('journal.keys')}</p>{/if}
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
                {#each journal.lessons as lesson (columnKey(lesson))}
                  <th class="day" class:manual={lesson.kind === 'manual'}>
                    {#if lesson.kind === 'lesson'}
                      <a
                        href={`/teacher/session/${lesson.sessionId}/results`}
                        title={`${registerDate(lesson.date)} · ${lesson.lessonTitle}`}
                      >
                        {shortDate(lesson.date)}
                      </a>
                    {:else}
                      <span class="date" title={registerDate(lesson.date)}
                        >{shortDate(lesson.date)}</span
                      >
                    {/if}
                    <span class="topic">{lesson.lessonTitle}</span>
                    {#if lesson.kind === 'manual'}
                      <button
                        type="button"
                        class="x"
                        aria-label={t('journal.column.delete')}
                        title={t('journal.column.delete')}
                        onclick={() => removeColumn(lesson)}>×</button
                      >
                    {/if}
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
                  {#each student.cells as cell, c (c)}
                    {@const l = journal.lessons[c]}
                    <td
                      class="cell"
                      class:absent={cell && !cell.present}
                      class:grade={cell?.present && cell.grade !== null}
                      class:offered={cell?.present && cell.grade !== null && !cell.confirmed}
                      class:noted={!!cell?.comment}
                      title={cell?.comment ??
                        (cell?.present && cell.grade !== null && !cell.confirmed
                          ? t('results.grades.offered')
                          : undefined)}
                    >
                      {#if cell && l}
                        <button
                          type="button"
                          class="cellbtn"
                          data-cell={`${i}:${c}`}
                          data-student={student.id}
                          data-column={columnKey(l)}
                          onkeydown={(e) => onCellKey(e, i, c)}
                          ondblclick={() => note(student.id, l, cell.comment ?? '')}
                        >
                          {cell.grade === null && cell.present && l.kind === 'manual'
                            ? '·'
                            : cellText(cell)}
                        </button>
                      {/if}
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
  .cell.offered {
    /* Calculated, not yet confirmed by the teacher (H10). */
    font-weight: 400;
    font-style: italic;
  }
  .cell.grade {
    font-weight: 700;
  }
  .cell.noted .cellbtn {
    text-decoration: underline dotted;
  }
  .cellbtn {
    min-width: 2.5em;
    min-height: 2em;
    border: 1px solid transparent;
    border-radius: var(--radius-sm, 6px);
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .cellbtn:focus {
    outline: none;
    border-color: var(--c-accent);
    background: var(--c-accent-soft);
  }
  .day.manual {
    background: #f6f2ff;
  }
  .date {
    display: block;
    font-size: var(--text-md);
    color: var(--c-dark);
  }
  .x {
    border: 0;
    background: none;
    color: var(--c-muted);
    cursor: pointer;
  }
  .addcol {
    display: flex;
    gap: var(--space-3);
    align-items: end;
    flex-wrap: wrap;
  }
  .addcol label {
    display: grid;
    gap: var(--space-1);
  }
  .addcol label span {
    font-size: var(--text-sm);
    color: var(--c-muted);
  }
  .addcol input {
    font: inherit;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius-sm, 6px);
  }
  .addcol .wide input {
    min-width: 20em;
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
