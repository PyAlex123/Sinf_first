<script lang="ts">
  import type { LibraryItem, LibraryKind } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';

  /**
   * The library (PLAN.md 3.9; stage 4, W8): lessons and programmes other teachers made public. Find
   * by grade and words, look, copy for yourself, report what has no place in a school.
   */
  let { params: _params }: PageProps = $props();
  let kind = $state<LibraryKind>('lesson');
  let grade = $state<number | null>(null);
  let q = $state('');
  let items = $state<LibraryItem[]>([]);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);

  let timer: ReturnType<typeof setTimeout> | null = null;
  async function load(): Promise<void> {
    try {
      items = (await api.library(kind, grade, q.trim())).items;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401)
        router.navigate('/teacher/login', { replace: true });
      else error = t('common.error');
    } finally {
      loaded = true;
    }
  }
  function later(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void load(), 300);
  }

  async function copy(item: LibraryItem): Promise<void> {
    try {
      if (item.kind === 'lesson') {
        const mine = await api.copyAuthoredLesson(item.id);
        router.navigate(`/teacher/lessons/${mine.id}/edit`);
      } else {
        const mine = await api.copyProgram(item.id);
        router.navigate(`/teacher/programs/${mine.id}`);
      }
    } catch (e) {
      error =
        e instanceof ApiError && e.code === 'edit_on_platform'
          ? t('own.onPlatform')
          : t('common.error');
    }
  }

  async function report(item: LibraryItem): Promise<void> {
    const reason = prompt(t('library.reportReason', { title: item.title }));
    if (!reason || reason.trim().length < 3) return;
    try {
      await api.reportItem(item.kind, item.id, reason.trim());
      notice = t('library.reported');
    } catch {
      error = t('common.error');
    }
  }

  onMount(() => void load());
</script>

<Header back="/teacher" title={t('library.title')} />

<main class="page stack">
  <PageHeader title={t('library.title')} subtitle={t('library.subtitle')} />
  {#if error}<Notice kind="error">{error}</Notice>{/if}
  {#if notice}<Notice kind="ok">{notice}</Notice>{/if}

  <div class="filters">
    <div class="tabs" role="group">
      <button
        type="button"
        class:on={kind === 'lesson'}
        onclick={() => ((kind = 'lesson'), void load())}
      >
        {t('library.lessons')}
      </button>
      <button
        type="button"
        class:on={kind === 'program'}
        onclick={() => ((kind = 'program'), void load())}
      >
        {t('library.programs')}
      </button>
    </div>
    <select
      aria-label={t('class.create.grade')}
      value={grade ?? ''}
      onchange={(e) => {
        grade = e.currentTarget.value ? Number(e.currentTarget.value) : null;
        void load();
      }}
      data-field="grade"
    >
      <option value="">{t('library.anyGrade')}</option>
      {#each Array.from({ length: 11 }, (_, i) => i + 1) as g (g)}
        <option value={g}>{t('library.grade', { grade: g })}</option>
      {/each}
    </select>
    <input bind:value={q} oninput={later} placeholder={t('library.search')} data-field="q" />
  </div>

  {#if loaded && items.length === 0}<p class="muted">{t('library.none')}</p>{/if}
  <ul class="list">
    {#each items as item (item.id)}
      <li data-item={item.id}>
        <Card>
          <div class="row">
            <div class="info">
              <b>{item.title}</b>
              <div class="muted small">
                {t('library.meta', { grade: item.grade, name: item.ownerName })}
                · {item.kind === 'lesson'
                  ? t('editor.minutes', { count: item.size })
                  : t('programs.meta', { grade: item.grade, count: item.size })}
                {#if item.copies > 0}· {t('library.copies', { count: item.copies })}{/if}
              </div>
              {#if item.topic}<div class="muted small">{item.topic}</div>{/if}
            </div>
            {#if item.kind === 'lesson'}
              <Button size="sm" variant="ghost" href={`/teacher/lesson/${item.id}`}
                >{t('teacher.lesson.open')}</Button
              >
            {/if}
            {#if !item.mine}
              <Button size="sm" onclick={() => copy(item)}>{t('own.copy')}</Button>
              <Button size="sm" variant="ghost" onclick={() => report(item)}
                >{t('library.report')}</Button
              >
            {:else}
              <span class="muted small">{t('library.mine')}</span>
            {/if}
          </div>
        </Card>
      </li>
    {/each}
  </ul>
</main>

<style>
  .filters {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    align-items: center;
  }
  .filters input,
  .filters select {
    font: inherit;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius-sm, 6px);
  }
  .filters input {
    flex: 1 1 240px;
  }
  .tabs {
    display: inline-flex;
    gap: var(--space-1);
  }
  .tabs button {
    min-height: var(--control-sm);
    padding: 0 var(--space-3);
    border: 1px solid var(--c-line-strong);
    border-radius: var(--radius-pill);
    background: var(--c-surface);
    font-weight: 700;
    color: var(--c-muted);
  }
  .tabs button.on {
    border-color: var(--c-accent);
    background: var(--c-accent-soft);
    color: var(--c-accent-strong);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    flex-wrap: wrap;
  }
  .info {
    flex: 1 1 260px;
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
</style>
