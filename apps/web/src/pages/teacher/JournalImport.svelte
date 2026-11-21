<script lang="ts">
  import {
    headerDate,
    matchStudent,
    MAX_IMPORT_COLUMNS,
    readGradeCell,
    type NameMatch,
    type ParsedTables,
    type Student,
  } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Field from '../../lib/ui/Field.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';

  /**
   * Grades from a file into the journal (PLAN.md 5.5; stage 4, W13): the KTP's wizard (W10) for the
   * table and its columns; names matched to the class by surname and first name, the doubtful ones
   * confirmed by the teacher; each chosen column becomes a journal column without a lesson.
   */
  let { params }: PageProps = $props();
  const classId = $derived(params['classId'] ?? '');

  /** A row's choice: a child, `skip`, or `''` — still to decide (a doubt). */
  type Choice = string;
  interface GradeColumn {
    col: number;
    take: boolean;
    date: string;
    title: string;
  }

  let className = $state('');
  let roster = $state<Student[]>([]);
  let tables = $state<ParsedTables['tables']>([]);
  let tableIndex = $state(0);
  let header = $state(0);
  let nameCol = $state(-1);
  let firstCol = $state(-1);
  let columns = $state<GradeColumn[]>([]);
  let choices = $state<Record<number, Choice>>({});
  let reading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  const today = new Date();
  const todayText = today.toISOString().slice(0, 10);
  const rows = $derived(tables[tableIndex]?.rows ?? []);
  const width = $derived(rows[0]?.length ?? 0);
  const active = $derived(roster.filter((s) => s.isActive));
  const nameOf = (s: Student): string => `${s.lastName} ${s.firstName}`;

  /** The file's children: row index in the table, the name as written, who it is. */
  const people = $derived.by(() => {
    if (nameCol < 0) return [];
    const list = active.map((s) => ({ id: s.id, firstName: s.firstName, lastName: s.lastName }));
    return rows.slice(header + 1).flatMap((row, i) => {
      const name = [row[nameCol] ?? '', firstCol >= 0 ? (row[firstCol] ?? '') : '']
        .join(' ')
        .trim();
      if (!/\p{L}/u.test(name)) return [];
      return [{ index: header + 1 + i, name, match: matchStudent(name, list) }];
    });
  });

  const chosen = (index: number, match: NameMatch): Choice =>
    choices[index] ??
    (match.status === 'exact' ? (match.studentId ?? '') : match.status === 'none' ? 'skip' : '');
  const undecided = $derived(people.filter((p) => chosen(p.index, p.match) === '').length);
  const taken = $derived(columns.filter((c) => c.take));

  /** The same child twice: the second row is not taken. */
  const twice = $derived.by(() => {
    const seen: Record<string, true> = {};
    const dup: Record<number, true> = {};
    for (const p of people) {
      const id = chosen(p.index, p.match);
      if (!id || id === 'skip') continue;
      if (seen[id]) dup[p.index] = true;
      seen[id] = true;
    }
    return dup;
  });

  const gradeCount = (rowIndex: number): number =>
    taken.filter((c) => readGradeCell(rows[rowIndex]?.[c.col] ?? '') !== null).length;

  const NAME = /фио|ф\.и\.о|ученик|фамил|familiya|o.?quvchi|ism|имя/i;

  function guess(): void {
    // The header: the first row with a date in it, or with a "name" word.
    const found = rows
      .slice(0, 10)
      .findIndex((r) => r.some((c) => headerDate(c, today) !== null || NAME.test(c)));
    header = found >= 0 ? found : 0;
    guessColumns();
  }

  /** Which column is the names and which hold grades, under the header row. */
  function guessColumns(): void {
    const head = rows[header] ?? [];
    nameCol = head.findIndex((c) => NAME.test(c));
    if (nameCol < 0) {
      // The column with most letters is the names.
      const letters = head.map((_, c) =>
        rows.reduce((n, r) => n + ((r[c] ?? '').match(/\p{L}/gu)?.length ?? 0), 0),
      );
      nameCol = letters.indexOf(Math.max(...letters, 0));
    }
    firstCol = -1;
    columns = head.flatMap((cell, col): GradeColumn[] => {
      // The names, and the row numbers ("№" holds 2, 3, 4, 5 too) are not grades.
      if (col === nameCol || /^\s*(№.*|#|n\.?|no\.?|т\/р|t\/r)\s*$/i.test(cell)) return [];
      const date = headerDate(cell, today);
      const grades = rows.slice(header + 1).filter((r) => readGradeCell(r[col] ?? '') !== null);
      // A column is taken by itself only under a date; the others wait for the teacher's tick.
      return grades.length === 0
        ? []
        : [
            {
              col,
              take: date !== null,
              date: date ?? todayText,
              title: date
                ? t('gradesImport.defaultTitle')
                : cell.trim().slice(0, 60) || t('gradesImport.defaultTitle'),
            },
          ];
    });
    choices = {};
  }

  async function read(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    error = null;
    tables = [];
    if (!/\.(xlsx|docx)$/i.test(file.name)) {
      error = t('ktp.error.type');
      return;
    }
    reading = true;
    try {
      const parsed = await api.parseTables(file, file.name);
      if (parsed.tables.length === 0) {
        error = t('ktp.error.noTable');
        return;
      }
      tables = parsed.tables;
      tableIndex = tables.reduce(
        (best, table, i) => (table.rows.length > (tables[best]?.rows.length ?? 0) ? i : best),
        0,
      );
      guess();
    } catch (e) {
      error =
        e instanceof ApiError && e.code === 'file_old_or_protected'
          ? t('ktp.error.old')
          : e instanceof ApiError && e.status === 413
            ? t('ktp.error.big')
            : t('ktp.error.unreadable');
    } finally {
      reading = false;
    }
  }

  async function save(): Promise<void> {
    if (undecided > 0 || taken.length === 0) return;
    saving = true;
    error = null;
    try {
      await api.importGrades(classId, {
        columns: taken.slice(0, MAX_IMPORT_COLUMNS).map((c) => ({
          date: c.date,
          title: c.title.trim() || t('gradesImport.defaultTitle'),
          cells: people.flatMap((p) => {
            const studentId = chosen(p.index, p.match);
            const cell = readGradeCell(rows[p.index]?.[c.col] ?? '');
            return studentId && studentId !== 'skip' && cell && !twice[p.index]
              ? [{ studentId, ...cell }]
              : [];
          }),
        })),
      });
      router.navigate(`/teacher/journal/${classId}`, { replace: true });
    } catch {
      error = t('common.error');
    } finally {
      saving = false;
    }
  }

  onMount(async () => {
    try {
      const details = await api.classDetails(classId);
      className = details.class.name;
      roster = details.students;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401)
        router.navigate('/teacher/login', { replace: true });
      else
        error = e instanceof ApiError && e.status === 404 ? t('class.notFound') : t('common.error');
    }
  });
</script>

<Header back={`/teacher/journal/${classId}`} title={t('gradesImport.title')} />

<main class="page stack">
  <PageHeader
    title={t('gradesImport.title')}
    subtitle={className ? t('gradesImport.hint', { name: className }) : ''}
  />
  {#if error}<Notice kind="error">{error}</Notice>{/if}

  <Card>
    <Field label={t('gradesImport.file')} hint={t('ktp.fileHint')}>
      <input
        type="file"
        accept=".xlsx,.docx"
        onchange={read}
        disabled={reading}
        data-field="grades-file"
      />
    </Field>
    {#if reading}<p class="muted">{t('common.loading')}</p>{/if}
  </Card>

  {#if rows.length > 0}
    <Card>
      <h2>{t('ktp.columns')}</h2>
      <div class="grid">
        {#if tables.length > 1}
          <Field label={t('ktp.table')}>
            <select
              value={tableIndex}
              onchange={(e) => ((tableIndex = Number(e.currentTarget.value)), guess())}
            >
              {#each tables as table, i (i)}
                <option value={i}>{table.name}</option>
              {/each}
            </select>
          </Field>
        {/if}
        <Field label={t('ktp.header')}>
          <select
            value={header}
            onchange={(e) => {
              header = Number(e.currentTarget.value);
              guessColumns();
            }}
            data-field="grades-header"
          >
            {#each rows.slice(0, 10) as r, i (i)}
              <option value={i}>{i + 1}: {r.filter(Boolean).join(' · ').slice(0, 60)}</option>
            {/each}
          </select>
        </Field>
        <Field label={t('gradesImport.nameCol')}>
          <select bind:value={nameCol} data-field="grades-name">
            {#each Array.from({ length: width }, (_, c) => c) as c (c)}
              <option value={c}
                >{t('ktp.column', { n: c + 1 })}: {(rows[header]?.[c] ?? '').slice(0, 30)}</option
              >
            {/each}
          </select>
        </Field>
        <Field label={t('gradesImport.firstCol')}>
          <select bind:value={firstCol}>
            <option value={-1}>{t('gradesImport.together')}</option>
            {#each Array.from({ length: width }, (_, c) => c) as c (c)}
              <option value={c}
                >{t('ktp.column', { n: c + 1 })}: {(rows[header]?.[c] ?? '').slice(0, 30)}</option
              >
            {/each}
          </select>
        </Field>
      </div>

      <h3>{t('gradesImport.gradeCols')}</h3>
      {#if columns.length === 0}
        <p class="muted">{t('gradesImport.noGrades')}</p>
      {/if}
      <ul class="cols">
        {#each columns as column (column.col)}
          <li data-gcol={column.col}>
            <label class="take">
              <input type="checkbox" bind:checked={column.take} />
              {t('ktp.column', { n: column.col + 1 })}: <b>{rows[header]?.[column.col] ?? ''}</b>
            </label>
            <input type="date" bind:value={column.date} disabled={!column.take} />
            <input
              bind:value={column.title}
              maxlength="60"
              disabled={!column.take}
              placeholder={t('journal.column.title')}
            />
          </li>
        {/each}
      </ul>
    </Card>

    {#if people.length > 0}
      <Card>
        <div class="summary">
          <h2>{t('gradesImport.students')}</h2>
          <span class="muted" data-undecided={undecided}>
            {undecided > 0
              ? t('gradesImport.undecided', { count: undecided })
              : t('gradesImport.allClear')}
          </span>
        </div>
        <div class="wrap">
          <table>
            <thead>
              <tr>
                <th>{t('gradesImport.inFile')}</th>
                <th>{t('gradesImport.inClass')}</th>
                <th>{t('gradesImport.grades')}</th>
              </tr>
            </thead>
            <tbody>
              {#each people as p (p.index)}
                {@const choice = chosen(p.index, p.match)}
                <tr
                  class:doubt={choice === ''}
                  class:skip={choice === 'skip'}
                  data-person={p.match.status}
                >
                  <td>{p.name}</td>
                  <td>
                    {#if p.match.status === 'exact' && choices[p.index] === undefined}
                      <span class="ok">✓</span>
                      {active.find((s) => s.id === p.match.studentId)?.lastName ?? ''}
                      {active.find((s) => s.id === p.match.studentId)?.firstName ?? ''}
                      <button
                        type="button"
                        class="link muted"
                        onclick={() =>
                          (choices = { ...choices, [p.index]: p.match.studentId ?? '' })}
                        >{t('gradesImport.change')}</button
                      >
                    {:else}
                      <select
                        value={choice}
                        onchange={(e) =>
                          (choices = { ...choices, [p.index]: e.currentTarget.value })}
                        data-choose={p.index}
                      >
                        <option value="" disabled>{t('ktp.choose')}</option>
                        {#each p.match.candidates as id (id)}
                          {@const s = active.find((x) => x.id === id)}
                          {#if s}<option value={s.id}
                              >{nameOf(s)} — {t('gradesImport.maybe')}</option
                            >{/if}
                        {/each}
                        <option value="skip">{t('gradesImport.skip')}</option>
                        <optgroup label={t('gradesImport.wholeClass')}>
                          {#each active as s (s.id)}<option value={s.id}>{nameOf(s)}</option>{/each}
                        </optgroup>
                      </select>
                    {/if}
                    {#if twice[p.index]}<div class="problem small">
                        {t('gradesImport.twice')}
                      </div>{/if}
                  </td>
                  <td class="muted">{gradeCount(p.index)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="actions">
          <Button onclick={save} disabled={saving || undecided > 0 || taken.length === 0}>
            {t('gradesImport.save', { count: taken.length })}
          </Button>
        </div>
      </Card>
    {/if}
  {/if}
</main>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--space-3);
  }
  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--text-lg);
  }
  h3 {
    margin: var(--space-4) 0 var(--space-2);
    font-size: var(--text-md);
  }
  .cols {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .cols li {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
  }
  .cols input:not([type='checkbox']),
  select {
    min-height: var(--control-sm);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius);
    background: var(--c-surface);
    color: var(--c-dark);
  }
  .take {
    flex: 1 1 240px;
  }
  .summary {
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
    flex-wrap: wrap;
  }
  .wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    text-align: left;
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--c-line);
  }
  th {
    font-size: var(--text-sm);
    color: var(--c-muted);
  }
  tr.doubt {
    background: color-mix(in srgb, var(--c-star) 18%, transparent);
  }
  tr.skip td:first-child {
    color: var(--c-muted);
    text-decoration: line-through;
  }
  .ok {
    color: var(--c-ok);
    font-weight: 700;
  }
  .problem {
    color: var(--c-danger-strong);
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }
  .actions {
    margin-top: var(--space-3);
    display: flex;
    justify-content: flex-end;
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
</style>
