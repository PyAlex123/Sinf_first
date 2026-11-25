<script lang="ts">
  import { emaktabDue, registerDate, type Journal, type JournalCell } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { i18n, t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import { SaveQueue } from '../../lib/save-queue.js';
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
   * By hand, from the keyboard (PLAN.md 5.1): type 2–5 on a cell; "н" marks absent in a column
   * without a lesson; Backspace clears; arrows and Enter move; "к" (or "c") writes a note. With the
   * mouse or a finger: a click opens the cell's menu (review 2026-11-25).
   *
   * Saving (review 2026-11-25): a change shows at once and is saved in turn, one request at a time
   * (each answer is the whole journal, so two in flight could undo a grade, and a change that came
   * during another used to be dropped). A failed change stays on its cell, marked, with "Retry";
   * the table never goes away.
   *
   * Towards eMaktab (PLAN.md 5.4, W12): a view with only what eMaktab takes — confirmed grades and
   * "н" — a "moved" mark per column, and the hours left of its 72 for columns not moved yet.
   */

  let { params }: PageProps = $props();
  const classId = $derived(params['classId'] ?? '');

  let journal = $state<Journal | null>(null);
  /** The journal did not load: the page has nothing to show but this and "Retry". */
  let loadError = $state<string | null>(null);
  /** An action failed: said above the table, which stays. */
  let actionError = $state<string | null>(null);
  let adding = $state(false);
  let newDate = $state(new Date().toISOString().slice(0, 10));
  let newTitle = $state('');
  const queue = new SaveQueue();

  type Change = { value?: number | null; absent?: boolean; comment?: string | null };
  /** A cell changed here and not yet confirmed: shown at once; `failed` — the server said no. */
  interface Pending {
    change: Change;
    failed: boolean;
    seq: number;
  }
  let pending = $state<Record<string, Pending>>({});
  let seq = 0;
  const failedCount = $derived(Object.values(pending).filter((p) => p.failed).length);
  /** The cell whose menu is open, and where on the screen. */
  let menu = $state<{ row: number; col: number; x: number; y: number } | null>(null);
  /** "As in eMaktab": grades and "н" only, no stars or suggestions. */
  let eView = $state(false);
  let now = $state(new Date());

  const due = $derived(journal ? emaktabDue(journal, now) : []);
  const hoursLeft = $derived(new Map(due.map((d) => [d.index, d.hoursLeft])));
  const hasGrades = (c: number): boolean =>
    !!journal?.students.some((s) => s.cells[c]?.grade != null);

  function failure(e: unknown): string {
    if (!(e instanceof ApiError)) return t('common.error');
    if (e.code === 'lesson_running') return t('journal.running');
    if (e.code === 'not_at_lesson') return t('journal.notThere');
    if (e.code === 'edit_on_platform') return t('emaktab.onPlatform');
    return t('common.error');
  }

  async function markEmaktab(l: Lesson, done: boolean): Promise<void> {
    try {
      journal = await queue.run(() => api.setEmaktab(classId, { column: columnRef(l), done }));
      now = new Date();
    } catch (e) {
      actionError = failure(e);
    }
  }

  type Lesson = Journal['lessons'][number];
  const columnKey = (l: Lesson): string => l.sessionId ?? l.columnId ?? '';
  const columnRef = (l: Lesson) =>
    l.kind === 'lesson'
      ? { kind: 'lesson' as const, sessionId: l.sessionId ?? '' }
      : { kind: 'manual' as const, columnId: l.columnId ?? '' };

  async function addColumn(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!newTitle.trim()) return;
    const date = newDate;
    const title = newTitle.trim();
    try {
      journal = await queue.run(() => api.addJournalColumn(classId, date, title));
      newTitle = '';
      adding = false;
    } catch (e) {
      actionError = failure(e);
    }
  }

  async function removeColumn(l: Lesson): Promise<void> {
    if (!l.columnId || !confirm(t('journal.column.deleteConfirm', { title: l.lessonTitle })))
      return;
    const columnId = l.columnId;
    try {
      journal = await queue.run(() => api.deleteJournalColumn(classId, columnId));
    } catch (e) {
      actionError = failure(e);
    }
  }

  const cellKey = (studentId: string, l: Lesson): string => `${studentId}|${columnKey(l)}`;

  function forget(key: string): void {
    pending = Object.fromEntries(Object.entries(pending).filter(([k]) => k !== key));
  }

  /** Shows the change at once and saves it in turn. A change on a failed cell carries the failed one. */
  function setCell(studentId: string, l: Lesson, change: Change): void {
    const key = cellKey(studentId, l);
    const before = pending[key];
    const send = before?.failed ? { ...before.change, ...change } : change;
    const mine = ++seq;
    pending = {
      ...pending,
      [key]: { change: { ...(before?.change ?? {}), ...change }, failed: false, seq: mine },
    };
    const column = columnRef(l);
    queue
      .run(() => api.setJournalCell(classId, { column, studentId, ...send }))
      .then((next) => {
        journal = next;
        if (pending[key]?.seq === mine) forget(key);
      })
      .catch((e: unknown) => {
        const now = pending[key];
        if (now?.seq === mine) pending = { ...pending, [key]: { ...now, failed: true } };
        actionError = failure(e);
      });
  }

  /** Sends every failed change again. */
  function retryFailed(): void {
    if (!journal) return;
    actionError = null;
    for (const [key, p] of Object.entries(pending)) {
      if (!p.failed) continue;
      const [studentId = '', column = ''] = key.split('|');
      const l = journal.lessons.find((x) => columnKey(x) === column);
      if (l) setCell(studentId, l, p.change);
    }
  }

  /** The cell as it is about to be: the server's, with this computer's unsaved change on top. */
  function shown(cell: JournalCell, studentId: string, l: Lesson): JournalCell {
    const p = pending[cellKey(studentId, l)];
    if (!p) return cell;
    const c = p.change;
    return {
      ...cell,
      present: c.absent === true ? false : c.absent === false ? true : cell.present,
      grade: c.value !== undefined ? c.value : cell.grade,
      confirmed: c.value !== undefined ? true : cell.confirmed,
      comment: c.comment !== undefined ? c.comment : cell.comment,
    };
  }

  /** The keyboard of a cell: 2–5, "н", Backspace, a note, and the arrows. */
  function onCellKey(event: KeyboardEvent, row: number, col: number): void {
    if (!journal) return;
    // Typing on a cell is the keyboard way: the mouse's menu steps aside.
    if (menu && event.key !== 'Tab') menu = null;
    const student = journal.students[row];
    const l = journal.lessons[col];
    if (!student || !l) return;
    const key = event.key.toLowerCase();
    if (/^[2-5]$/.test(key)) {
      event.preventDefault();
      setCell(student.id, l, { value: Number(key) });
      focusCell(row + 1, col);
    } else if ((key === 'н' || key === 'n' || key === 'y') && l.kind === 'manual') {
      event.preventDefault();
      setCell(student.id, l, { absent: true });
      focusCell(row + 1, col);
    } else if (key === 'backspace' || key === 'delete') {
      event.preventDefault();
      setCell(
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
    setCell(studentId, l, { comment: text.trim() || null });
  }

  /** The cell's menu, for the mouse and the finger; the keyboard keeps its keys. */
  function openMenu(row: number, col: number, button: HTMLElement): void {
    if (menu?.row === row && menu.col === col) {
      menu = null;
      return;
    }
    const box = button.getBoundingClientRect();
    menu = {
      row,
      col,
      x: Math.max(8, Math.min(box.left, window.innerWidth - 280)),
      y: Math.min(box.bottom + 4, window.innerHeight - 64),
    };
  }

  function closeMenu(refocus = false): void {
    const was = menu;
    menu = null;
    if (refocus && was) focusCell(was.row, was.col);
  }

  function pick(change: Change, next = true): void {
    if (!menu || !journal) return;
    const { row, col } = menu;
    const student = journal.students[row];
    const l = journal.lessons[col];
    menu = null;
    if (!student || !l) return;
    setCell(student.id, l, change);
    focusCell(next ? row + 1 : row, col);
  }

  function pickNote(): void {
    if (!menu || !journal) return;
    const { row, col } = menu;
    const student = journal.students[row];
    const l = journal.lessons[col];
    menu = null;
    if (!student || !l) return;
    note(student.id, l, shown(student.cells[col] as JournalCell, student.id, l).comment ?? '');
  }

  /** Grades still on their way: the browser asks before the page goes. */
  function onLeave(event: BeforeUnloadEvent): void {
    if (queue.size > 0) event.preventDefault();
  }

  function onWindowKey(event: KeyboardEvent): void {
    if (menu && event.key === 'Escape') closeMenu(true);
  }

  /** The menu closes on Escape, a click elsewhere or a scroll that would move its cell away. */
  function onWindowPointer(event: PointerEvent): void {
    if (menu && !(event.target as HTMLElement | null)?.closest?.('.pick, .cellbtn')) closeMenu();
  }

  function focusCell(row: number, col: number): void {
    const el = document.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`);
    el?.focus();
  }

  /** `05.11`: the year is the same across one journal, so the column stays narrow. */
  const shortDate = (date: string): string => registerDate(date).slice(0, 5);

  function cellText(cell: JournalCell): string {
    if (!cell.present) return t('journal.absent');
    if (eView) return cell.grade !== null && cell.confirmed ? String(cell.grade) : '';
    return cell.grade !== null ? String(cell.grade) : `★ ${cell.stars}`;
  }

  async function load(): Promise<void> {
    loadError = null;
    try {
      journal = await api.journal(classId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.navigate('/teacher/login', { replace: true });
        return;
      }
      loadError =
        e instanceof ApiError && e.status === 404 ? t('class.notFound') : t('common.error');
    }
  }

  onMount(() => {
    void load();
  });
</script>

<svelte:window
  onpointerdown={onWindowPointer}
  onbeforeunload={onLeave}
  onresize={() => closeMenu()}
  onkeydown={onWindowKey}
/>

<Header back="/teacher" />

<main class="page stack">
  {#if loadError}
    <Notice kind="error">{loadError}</Notice>
    <div><Button variant="secondary" onclick={load}>{t('common.retry')}</Button></div>
  {:else if !journal}
    <p aria-busy="true" class="muted">{t('common.loading')}</p>
  {:else}
    <PageHeader
      title={t('journal.title', { name: journal.class.name })}
      subtitle={t('journal.count', { count: journal.lessons.length })}
    >
      {#snippet actions()}
        {#if journal?.emaktab}
          <Button variant="secondary" onclick={() => (eView = !eView)} data-view="emaktab">
            {eView ? t('emaktab.viewOff') : t('emaktab.view')}
          </Button>
        {/if}
        <Button variant="secondary" onclick={() => (adding = !adding)}
          >{t('journal.column.add')}</Button
        >
        <!-- Grades kept in Excel before (PLAN.md 5.5, W13). -->
        <Button variant="secondary" href={`/teacher/journal/${classId}/import`}>
          {t('gradesImport.open')}
        </Button>
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

    {#if actionError}
      <Notice kind="error">
        <span class="action-error" data-journal-error>
          {actionError}
          {#if failedCount > 0}
            <Button size="sm" variant="secondary" onclick={retryFailed}>{t('common.retry')}</Button>
          {/if}
          <Button size="sm" variant="ghost" onclick={() => (actionError = null)}
            >{t('common.close')}</Button
          >
        </span>
      </Notice>
    {/if}
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
    {#if due.length > 0}
      <!-- eMaktab takes a grade for 72 hours from the lesson's day (CLAUDE.md §4.10). -->
      <Notice kind="warn">
        <span data-emaktab-due>
          {t('emaktab.due')}
          {#each due as d, k (d.index)}
            {@const l = journal.lessons[d.index]}
            {#if l}{k > 0 ? '; ' : ' '}<b>{shortDate(l.date)} {l.lessonTitle}</b> — {t(
                'emaktab.hoursLeft',
                { count: d.hoursLeft },
              )}{/if}
          {/each}
        </span>
      </Notice>
    {/if}
    {#if journal.lessons.length > 0}<p class="muted small">
        {eView ? t('emaktab.legend') : t('journal.keys')}
      </p>{/if}
    {#if journal.lessons.length === 0}
      <EmptyState icon="star" title={t('journal.empty.title')} text={t('journal.empty')} />
    {:else}
      <Card>
        <div class="scroll" onscroll={() => closeMenu()}>
          <table>
            <thead>
              <tr>
                <th class="num sticky">№</th>
                <th class="who sticky">{t('results.col.student')}</th>
                {#each journal.lessons as lesson, c (columnKey(lesson))}
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
                    {#if journal.emaktab && lesson.emaktabAt}
                      <button
                        type="button"
                        class="em moved"
                        title={t('emaktab.movedAt', {
                          date: registerDate(lesson.emaktabAt.slice(0, 10)),
                        })}
                        onclick={() => markEmaktab(lesson, false)}
                        data-emaktab={c}>✓ eMaktab</button
                      >
                    {:else if journal.emaktab && hasGrades(c)}
                      <button
                        type="button"
                        class="em"
                        class:late={!hoursLeft.has(c)}
                        title={t('emaktab.mark')}
                        onclick={() => markEmaktab(lesson, true)}
                        data-emaktab={c}
                      >
                        {hoursLeft.has(c)
                          ? t('emaktab.markShort', { hours: hoursLeft.get(c) ?? 0 })
                          : t('emaktab.late')}
                      </button>
                    {/if}
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
                  {#each student.cells as raw, c (c)}
                    {@const l = journal.lessons[c]}
                    {@const cell = raw && l ? shown(raw, student.id, l) : raw}
                    {@const state = l ? pending[cellKey(student.id, l)] : undefined}
                    <td
                      class="cell"
                      class:absent={cell && !cell.present}
                      class:grade={cell?.present && cell.grade !== null}
                      class:offered={!eView &&
                        cell?.present &&
                        cell.grade !== null &&
                        !cell.confirmed}
                      class:noted={!!cell?.comment}
                      class:saving={state && !state.failed}
                      class:failed={state?.failed}
                      title={state?.failed
                        ? t('journal.unsaved')
                        : (cell?.comment ??
                          (cell?.present && cell.grade !== null && !cell.confirmed
                            ? t('results.grades.offered')
                            : undefined))}
                    >
                      {#if cell && l}
                        <button
                          type="button"
                          class="cellbtn"
                          data-cell={`${i}:${c}`}
                          data-student={student.id}
                          data-column={columnKey(l)}
                          aria-haspopup="true"
                          aria-expanded={menu?.row === i && menu?.col === c}
                          onkeydown={(e) => onCellKey(e, i, c)}
                          onclick={(e) => openMenu(i, c, e.currentTarget)}
                        >
                          {!eView && cell.grade === null && cell.present && l.kind === 'manual'
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
    {#if menu}
      {@const student = journal.students[menu.row]}
      {@const l = journal.lessons[menu.col]}
      {#if student && l}
        <div
          class="pick"
          role="group"
          aria-label={t('journal.pick', { name: student.name })}
          style={`left:${menu.x}px;top:${menu.y}px`}
          data-journal-menu
        >
          {#each [5, 4, 3, 2] as value (value)}
            <button type="button" class="grade" onclick={() => pick({ value })}>{value}</button>
          {/each}
          {#if l.kind === 'manual'}
            <button type="button" onclick={() => pick({ absent: true })}
              >{t('journal.absent')}</button
            >
          {/if}
          <button
            type="button"
            onclick={() =>
              pick(l.kind === 'manual' ? { value: null, absent: false } : { value: null }, false)}
            >{t('journal.clear')}</button
          >
          <button type="button" onclick={pickNote}>{t('journal.comment')}</button>
        </div>
      {/if}
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
  .cellbtn:hover {
    background: var(--c-bg-2);
  }
  .cellbtn:focus-visible {
    outline: var(--focus-ring) solid var(--c-accent);
    outline-offset: 1px;
    background: var(--c-accent-soft);
  }
  /* Shown before the server confirmed it; a failed one keeps its value, framed in red. */
  .cell.saving .cellbtn {
    color: var(--c-muted);
  }
  .cell.failed .cellbtn {
    border-color: var(--c-danger);
    background: var(--c-danger-soft);
  }
  .action-error {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .pick {
    position: fixed;
    z-index: 20;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    max-width: 272px;
    padding: var(--space-2);
    background: var(--c-surface);
    border: 1px solid var(--c-line-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
  }
  .pick button {
    min-width: 44px;
    min-height: 44px;
    padding: 0 var(--space-2);
    border: 1px solid var(--c-line-strong);
    border-radius: var(--radius-sm);
    background: var(--c-surface);
    font: inherit;
    color: var(--c-dark);
    cursor: pointer;
  }
  .pick button.grade {
    font-weight: 700;
    font-size: var(--text-lg);
  }
  .pick button:hover,
  .pick button:focus-visible {
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
  /* The column's way to eMaktab (W12): to move, with its hours left; moved; too late. */
  .em {
    display: block;
    margin: var(--space-1) auto 0;
    padding: 0 var(--space-1);
    border: 1px solid var(--c-accent);
    border-radius: var(--radius-pill);
    background: var(--c-surface);
    color: var(--c-accent-strong);
    font-size: var(--text-xs, 0.75rem);
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
  }
  .em.moved {
    border-color: var(--c-ok);
    color: var(--c-ok);
  }
  .em.late {
    border-color: var(--c-line-strong);
    color: var(--c-muted);
    font-weight: 400;
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
