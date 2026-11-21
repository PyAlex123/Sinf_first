<script lang="ts">
  import type { AuthoredLessonSummary, LessonVisibility, Program, ProgramItem } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { loadCourses } from '../../lib/content.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';

  /**
   * A programme by quarters (PLAN.md 3.8; stage 4, W7): the author's lessons and the teacher's own,
   * put into the four quarters of the year in the order they are taught.
   */
  let { params }: PageProps = $props();
  const id = $derived(params['id'] ?? '');

  interface Pick {
    id: string;
    title: string;
    group: string;
  }

  let program = $state<Program | null>(null);
  let items = $state<(ProgramItem & { title: string })[]>([]);
  let title = $state('');
  let grade = $state(5);
  let visibility = $state<LessonVisibility>('private');
  let version = $state(1);
  let catalog = $state<Pick[]>([]);
  let search = $state('');
  let quarter = $state(1);
  let error = $state<string | null>(null);
  let status = $state<'saved' | 'dirty' | 'saving' | 'conflict'>('saved');

  const found = $derived(
    catalog
      .filter((l) => !search.trim() || l.title.toLowerCase().includes(search.trim().toLowerCase()))
      .slice(0, 40),
  );

  onMount(() => {
    void (async () => {
      try {
        const p = await api.program(id);
        program = p;
        items = p.items.map((i) => ({ lessonId: i.lessonId, quarter: i.quarter, title: i.title }));
        title = p.title;
        grade = p.grade;
        visibility = p.visibility;
        version = p.version;
        const [courses, mine, school] = await Promise.all([
          loadCourses(),
          api.authoredLessons('mine'),
          api.authoredLessons('school'),
        ]);
        catalog = [
          ...mine.lessons.map((l: AuthoredLessonSummary) => ({
            id: l.id,
            title: l.title,
            group: 'own',
          })),
          ...school.lessons.map((l: AuthoredLessonSummary) => ({
            id: l.id,
            title: l.title,
            group: 'school',
          })),
          ...courses.flatMap((c) =>
            c.lessons.map((l) => ({ id: l.id, title: `${l.num}. ${l.title}`, group: l.group })),
          ),
        ];
      } catch (e) {
        if (e instanceof ApiError && e.status === 401)
          router.navigate('/teacher/login', { replace: true });
        else
          error =
            e instanceof ApiError && e.status === 404 ? t('common.notFound') : t('common.error');
      }
    })();
  });

  function changed(): void {
    if (status !== 'conflict') status = 'dirty';
  }

  function add(pick: Pick): void {
    items = [...items, { lessonId: pick.id, quarter, title: pick.title }];
    changed();
  }

  function move(i: number, by: number): void {
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    const list = [...items];
    const [item] = list.splice(i, 1);
    if (item) list.splice(j, 0, item);
    items = list;
    changed();
  }

  function remove(i: number): void {
    items = items.filter((_, j) => j !== i);
    changed();
  }

  async function save(): Promise<void> {
    if (!program || status === 'saving') return;
    status = 'saving';
    error = null;
    try {
      // Quarters in order, and within a quarter the order the teacher set.
      const ordered = [1, 2, 3, 4].flatMap((q) => items.filter((i) => i.quarter === q));
      const saved = await api.saveProgram(program.id, {
        title: title.trim() || program.title,
        grade,
        visibility,
        items: ordered.map((i) => ({ lessonId: i.lessonId, quarter: i.quarter })),
        version,
      });
      version = saved.version;
      items = saved.items.map((i) => ({
        lessonId: i.lessonId,
        quarter: i.quarter,
        title: i.title,
      }));
      status = 'saved';
    } catch (e) {
      status = e instanceof ApiError && e.code === 'version_conflict' ? 'conflict' : 'dirty';
      if (status === 'dirty') error = t('common.error');
    }
  }
</script>

<Header back="/teacher/programs" title={title || t('programs.title')}>
  <span class="status" data-status={status}>{t(`editor.status.${status}`)}</span>
  {#if program?.editable}
    <Button size="sm" disabled={status === 'saved' || status === 'saving'} onclick={save}
      >{t('common.save')}</Button
    >
  {/if}
</Header>

<main class="page stack">
  {#if error}<Notice kind="error">{error}</Notice>{/if}
  {#if status === 'conflict'}<Notice kind="error">{t('editor.conflict')}</Notice>{/if}
  {#if program}
    <section class="meta">
      <label class="wide">
        <span>{t('programs.name')}</span>
        <input bind:value={title} oninput={changed} maxlength="120" disabled={!program.editable} />
      </label>
      <label>
        <span>{t('class.create.grade')}</span>
        <select bind:value={grade} onchange={changed} disabled={!program.editable}>
          {#each Array.from({ length: 11 }, (_, i) => i + 1) as g (g)}
            <option value={g}>{g}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>{t('editor.visibility')}</span>
        <select bind:value={visibility} onchange={changed} disabled={!program.editable}>
          <option value="private">{t('own.visibility.private')}</option>
          <option value="school">{t('own.visibility.school')}</option>
          <option value="public">{t('own.visibility.public')}</option>
        </select>
      </label>
    </section>

    <div class="layout">
      <section class="quarters">
        {#each [1, 2, 3, 4] as q (q)}
          <div class="quarter" data-quarter={q}>
            <h2>{t('programs.quarter', { n: q })}</h2>
            <ol>
              {#each items as item, i (i)}
                {#if item.quarter === q}
                  <li>
                    <span class="name">{item.title}</span>
                    {#if program.editable}
                      <span class="tools">
                        <button
                          type="button"
                          aria-label={t('editor.up')}
                          onclick={() => move(i, -1)}>↑</button
                        >
                        <button
                          type="button"
                          aria-label={t('editor.down')}
                          onclick={() => move(i, 1)}>↓</button
                        >
                        <select
                          aria-label={t('programs.quarterOf')}
                          value={item.quarter}
                          onchange={(e) => {
                            item.quarter = Number(e.currentTarget.value);
                            changed();
                          }}
                        >
                          {#each [1, 2, 3, 4] as qq (qq)}<option value={qq}>{qq}</option>{/each}
                        </select>
                        <button type="button" aria-label={t('own.delete')} onclick={() => remove(i)}
                          >×</button
                        >
                      </span>
                    {/if}
                  </li>
                {/if}
              {/each}
            </ol>
          </div>
        {/each}
      </section>

      {#if program.editable}
        <section class="picker">
          <h2>{t('programs.add')}</h2>
          <label>
            <span>{t('programs.toQuarter')}</span>
            <select bind:value={quarter} data-field="quarter">
              {#each [1, 2, 3, 4] as q (q)}<option value={q}
                  >{t('programs.quarter', { n: q })}</option
                >{/each}
            </select>
          </label>
          <input bind:value={search} placeholder={t('programs.search')} data-field="search" />
          <ul>
            {#each found as pick (pick.id)}
              <li>
                <button type="button" onclick={() => add(pick)} data-pick={pick.id}>
                  + {pick.title}
                  <small>{t(`programs.group.${pick.group}`)}</small>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </div>
  {:else if !error}
    <p aria-busy="true" class="muted">{t('common.loading')}</p>
  {/if}
</main>

<style>
  .status {
    font-size: var(--text-sm);
    color: var(--c-muted);
  }
  .meta {
    display: grid;
    grid-template-columns: 2fr 90px 160px;
    gap: var(--space-3);
  }
  label {
    display: grid;
    gap: var(--space-1);
  }
  label > span {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--c-muted);
  }
  input,
  select {
    font: inherit;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius-sm, 6px);
    background: var(--c-surface);
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: var(--space-4);
    align-items: start;
  }
  .quarters {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .quarter,
  .picker {
    padding: var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--c-surface);
    box-shadow: var(--shadow-sm, 0 1px 3px rgb(0 0 0 / 0.08));
  }
  h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-lg);
  }
  ol,
  .picker ul {
    margin: 0;
    padding-left: var(--space-4);
    display: grid;
    gap: var(--space-1);
  }
  .picker ul {
    list-style: none;
    padding: 0;
    max-height: 420px;
    overflow: auto;
  }
  li {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .name {
    flex: 1;
    min-width: 0;
  }
  .tools {
    display: inline-flex;
    gap: 2px;
  }
  .tools button {
    border: 0;
    background: none;
    cursor: pointer;
    font-size: var(--text-md);
  }
  .picker {
    display: grid;
    gap: var(--space-2);
  }
  .picker li button {
    width: 100%;
    text-align: left;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius-sm, 6px);
    background: var(--c-bg);
    font: inherit;
    cursor: pointer;
  }
  .picker small {
    color: var(--c-muted);
    margin-left: var(--space-1);
  }
  .muted {
    color: var(--c-muted);
  }
  @media (max-width: 1100px) {
    .layout,
    .quarters {
      grid-template-columns: 1fr;
    }
  }
</style>
