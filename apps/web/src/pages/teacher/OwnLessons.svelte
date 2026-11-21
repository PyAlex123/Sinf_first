<script lang="ts">
  import type { AuthoredLessonSummary } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router } from '../../lib/router.svelte.js';
  import Badge from '../../lib/ui/Badge.svelte';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Field from '../../lib/ui/Field.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Notice from '../../lib/ui/Notice.svelte';

  /**
   * The teacher's own lessons on the main page (stage 4, W1; ADR-019): a new one from the 45-minute
   * template in one click, the list of mine and of my school's, start for the class chosen on the
   * left, open, change, copy, delete.
   */
  let {
    canStart,
    busyId,
    onStart,
    defaultGrade,
  }: {
    canStart: boolean;
    busyId: string | null;
    onStart: (lessonId: string) => void;
    defaultGrade: number;
  } = $props();

  let scope = $state<'mine' | 'school'>('mine');
  let lessons = $state<AuthoredLessonSummary[]>([]);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let creating = $state(false);
  let title = $state('');
  // svelte-ignore state_referenced_locally
  let grade = $state(defaultGrade);
  let template = $state<'standard45' | 'empty'>('standard45');
  let saving = $state(false);
  /** The school computer keeps a read-only copy: lessons are made on the website (ADR-019). */
  let readOnly = $state(false);

  async function load(): Promise<void> {
    error = null;
    try {
      lessons = (await api.authoredLessons(scope)).lessons;
    } catch {
      error = t('common.error');
    } finally {
      loaded = true;
    }
  }

  async function create(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim() || saving) return;
    saving = true;
    error = null;
    try {
      const lesson = await api.createAuthoredLesson({
        title: title.trim(),
        grade,
        topic: '',
        visibility: 'private',
        template,
      });
      router.navigate(`/teacher/lessons/${lesson.id}/edit`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'edit_on_platform') readOnly = true;
      error =
        e instanceof ApiError && e.code === 'edit_on_platform'
          ? t('own.onPlatform')
          : t('common.error');
    } finally {
      saving = false;
    }
  }

  async function remove(lesson: AuthoredLessonSummary): Promise<void> {
    if (!confirm(t('own.deleteConfirm', { title: lesson.title }))) return;
    try {
      await api.deleteAuthoredLesson(lesson.id);
      lessons = lessons.filter((l) => l.id !== lesson.id);
    } catch {
      error = t('common.error');
    }
  }

  async function copy(lesson: AuthoredLessonSummary): Promise<void> {
    try {
      const mine = await api.copyAuthoredLesson(lesson.id);
      router.navigate(`/teacher/lessons/${mine.id}/edit`);
    } catch (e) {
      error =
        e instanceof ApiError && e.code === 'edit_on_platform'
          ? t('own.onPlatform')
          : t('common.error');
    }
  }

  function pick(next: 'mine' | 'school'): void {
    scope = next;
    void load();
  }

  onMount(() => void load());
</script>

<section class="own stack" aria-label={t('own.title')}>
  <div class="head">
    <div class="tabs" role="group">
      <button
        type="button"
        class:on={scope === 'mine'}
        aria-pressed={scope === 'mine'}
        onclick={() => pick('mine')}
      >
        {t('own.title')}
      </button>
      <button
        type="button"
        class:on={scope === 'school'}
        aria-pressed={scope === 'school'}
        onclick={() => pick('school')}
      >
        {t('own.school')}
      </button>
    </div>
    {#if scope === 'mine' && !creating && !readOnly}
      <Button size="sm" onclick={() => (creating = true)}>
        <Icon name="plus" size={16} />
        {t('own.create')}
      </Button>
    {/if}
  </div>

  {#if error}<Notice kind="error">{error}</Notice>{/if}

  {#if creating}
    <Card>
      <form class="create" onsubmit={create}>
        <Field label={t('own.lessonTitle')}>
          <input bind:value={title} required maxlength="120" data-field="title" />
        </Field>
        <Field label={t('class.create.grade')}>
          <select bind:value={grade}>
            {#each Array.from({ length: 11 }, (_, i) => i + 1) as g (g)}
              <option value={g}>{g}</option>
            {/each}
          </select>
        </Field>
        <fieldset>
          <label
            ><input type="radio" bind:group={template} value="standard45" />
            {t('own.template.standard')}</label
          >
          <label
            ><input type="radio" bind:group={template} value="empty" />
            {t('own.template.empty')}</label
          >
        </fieldset>
        <div class="actions">
          <Button type="submit" disabled={saving}>{t('own.createSubmit')}</Button>
          <Button variant="ghost" onclick={() => (creating = false)}>{t('common.cancel')}</Button>
        </div>
      </form>
    </Card>
  {/if}

  {#if loaded && lessons.length === 0}
    <p class="muted small">{scope === 'mine' ? t('own.none') : t('own.noneSchool')}</p>
  {/if}

  <ul class="list">
    {#each lessons as lesson (lesson.id)}
      <li data-lesson={lesson.id}>
        <Card padded={false}>
          <div class="row">
            <div class="info">
              <b>{lesson.title}</b>
              <div class="muted small">
                {t('own.meta', {
                  grade: lesson.grade,
                  minutes: lesson.minutes,
                  screens: lesson.screens,
                })}
                {#if scope === 'school'}
                  · {t('own.by', { name: lesson.ownerName })}{/if}
              </div>
              {#if lesson.topic}<div class="muted small">{lesson.topic}</div>{/if}
            </div>
            {#if lesson.visibility !== 'private'}
              <Badge tone="info">{t(`own.visibility.${lesson.visibility}`)}</Badge>
            {/if}
            <div class="btns">
              <Button
                size="sm"
                disabled={!canStart || busyId === lesson.id}
                onclick={() => onStart(lesson.id)}
              >
                <Icon name="play" size={16} />
                {t('teacher.lesson.start')}
              </Button>
              <Button size="sm" variant="ghost" href={`/teacher/lesson/${lesson.id}`}>
                {t('teacher.lesson.open')}
              </Button>
              {#if lesson.editable}
                <Button size="sm" variant="secondary" href={`/teacher/lessons/${lesson.id}/edit`}>
                  {t('own.edit')}
                </Button>
                <Button size="sm" variant="ghost" onclick={() => remove(lesson)}
                  >{t('own.delete')}</Button
                >
              {:else if scope === 'school' && !readOnly}
                <Button size="sm" variant="ghost" onclick={() => copy(lesson)}
                  >{t('own.copy')}</Button
                >
              {/if}
            </div>
          </div>
        </Card>
      </li>
    {/each}
  </ul>
</section>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
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
  .create {
    display: grid;
    gap: var(--space-3);
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }
  .actions,
  .btns {
    display: flex;
    gap: var(--space-2);
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
    padding: var(--space-3);
    flex-wrap: wrap;
  }
  .info {
    flex: 1 1 220px;
    min-width: 0;
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
</style>
