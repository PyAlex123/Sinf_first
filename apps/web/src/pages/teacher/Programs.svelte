<script lang="ts">
  import type { ProgramSummary } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Badge from '../../lib/ui/Badge.svelte';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Field from '../../lib/ui/Field.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';

  /** Programmes (PLAN.md 3.8; stage 4, W7): mine and my school's; new, copy, delete. */
  let { params: _params }: PageProps = $props();
  let scope = $state<'mine' | 'school'>('mine');
  let programs = $state<ProgramSummary[]>([]);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let title = $state('');
  let grade = $state(5);

  async function load(): Promise<void> {
    try {
      programs = (await api.programs(scope)).programs;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401)
        router.navigate('/teacher/login', { replace: true });
      else error = t('common.error');
    } finally {
      loaded = true;
    }
  }

  async function create(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim()) return;
    try {
      const made = await api.createProgram(title.trim(), grade);
      router.navigate(`/teacher/programs/${made.id}`);
    } catch (e) {
      error =
        e instanceof ApiError && e.code === 'edit_on_platform'
          ? t('own.onPlatform')
          : t('common.error');
    }
  }

  async function copy(p: ProgramSummary): Promise<void> {
    try {
      const mine = await api.copyProgram(p.id);
      router.navigate(`/teacher/programs/${mine.id}`);
    } catch {
      error = t('common.error');
    }
  }

  async function remove(p: ProgramSummary): Promise<void> {
    if (!confirm(t('programs.deleteConfirm', { title: p.title }))) return;
    try {
      await api.deleteProgram(p.id);
      programs = programs.filter((x) => x.id !== p.id);
    } catch {
      error = t('common.error');
    }
  }

  onMount(() => void load());
</script>

<Header back="/teacher" title={t('programs.title')} />

<main class="page stack">
  <PageHeader title={t('programs.title')} subtitle={t('programs.subtitle')} />
  {#if error}<Notice kind="error">{error}</Notice>{/if}

  <div class="tabs" role="group">
    <button
      type="button"
      class:on={scope === 'mine'}
      onclick={() => ((scope = 'mine'), void load())}
    >
      {t('programs.mine')}
    </button>
    <button
      type="button"
      class:on={scope === 'school'}
      onclick={() => ((scope = 'school'), void load())}
    >
      {t('programs.school')}
    </button>
  </div>

  {#if scope === 'mine'}
    <Card>
      <form class="create" onsubmit={create}>
        <Field label={t('programs.name')}>
          <input bind:value={title} maxlength="120" required data-field="program-title" />
        </Field>
        <Field label={t('class.create.grade')}>
          <select bind:value={grade}>
            {#each Array.from({ length: 11 }, (_, i) => i + 1) as g (g)}
              <option value={g}>{g}</option>
            {/each}
          </select>
        </Field>
        <Button type="submit">{t('programs.create')}</Button>
      </form>
    </Card>
  {/if}

  {#if loaded && programs.length === 0}
    <p class="muted">{scope === 'mine' ? t('programs.none') : t('programs.noneSchool')}</p>
  {/if}
  <ul class="list">
    {#each programs as p (p.id)}
      <li data-program={p.id}>
        <Card>
          <div class="row">
            <div class="info">
              <b>{p.title}</b>
              <div class="muted small">
                {t('programs.meta', { grade: p.grade, count: p.lessons })}
                {#if scope === 'school'}
                  · {t('own.by', { name: p.ownerName })}{/if}
              </div>
            </div>
            {#if p.visibility !== 'private'}<Badge tone="info"
                >{t(`own.visibility.${p.visibility}`)}</Badge
              >{/if}
            <Button size="sm" variant="secondary" href={`/teacher/programs/${p.id}`}>
              {p.editable ? t('own.edit') : t('teacher.lesson.open')}
            </Button>
            {#if p.editable}
              <Button size="sm" variant="ghost" onclick={() => remove(p)}>{t('own.delete')}</Button>
            {:else}
              <Button size="sm" variant="ghost" onclick={() => copy(p)}>{t('own.copy')}</Button>
            {/if}
          </div>
        </Card>
      </li>
    {/each}
  </ul>
</main>

<style>
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
  .create {
    display: flex;
    gap: var(--space-3);
    align-items: end;
    flex-wrap: wrap;
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
    flex: 1 1 240px;
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
</style>
