<script lang="ts">
  import type { ClassProgram, ProgramSummary } from '@sinf/shared';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Icon from '../../lib/ui/Icon.svelte';

  /**
   * The class's programme on the main page (PLAN.md 3.8; W7): which one, how far the class is, the
   * next lesson with a start button, and the choice of another programme.
   */
  let {
    classId,
    busyId,
    onStart,
  }: { classId: string; busyId: string | null; onStart: (lessonId: string) => void } = $props();

  let info = $state<ClassProgram | null>(null);
  let choices = $state<ProgramSummary[]>([]);
  /** The programme did not load: the card says so instead. */
  let error = $state(false);
  /** Choosing failed: said under the card, which keeps what it showed (review 2026-11-25). */
  let actionFailed = $state(false);
  let picking = $state(false);

  $effect(() => {
    const id = classId;
    info = null;
    picking = false;
    void api.classProgram(id).then(
      (p) => (info = p),
      () => (error = true),
    );
  });

  async function openPicker(): Promise<void> {
    picking = true;
    actionFailed = false;
    try {
      const [mine, school] = await Promise.all([api.programs('mine'), api.programs('school')]);
      choices = [...mine.programs, ...school.programs];
    } catch {
      actionFailed = true;
      picking = false;
    }
  }

  async function choose(programId: string | null): Promise<void> {
    actionFailed = false;
    try {
      info = await api.setClassProgram(classId, programId);
      picking = false;
    } catch (e) {
      actionFailed = !(e instanceof ApiError && e.code === 'edit_on_platform');
      picking = false;
    }
  }

  const done = $derived(info?.items.filter((i) => i.done).length ?? 0);
</script>

<Card>
  <h3 class="title">{t('programs.ofClass')}</h3>
  {#if error}
    <p class="muted small">{t('common.error')}</p>
  {:else if info?.program}
    <p class="name" data-class-program>{info.program.title}</p>
    <p class="muted small">{t('programs.progress', { done, total: info.items.length })}</p>
    {#if info.next}
      <div class="next" data-next={info.next.lessonId}>
        <span>{t('programs.next', { quarter: info.next.quarter })}</span>
        <b>{info.next.title}</b>
        <Button
          size="sm"
          disabled={busyId === info.next.lessonId}
          onclick={() => info?.next && onStart(info.next.lessonId)}
        >
          <Icon name="play" size={16} />
          {t('teacher.lesson.start')}
        </Button>
      </div>
    {:else}
      <p class="muted small">{t('programs.allDone')}</p>
    {/if}
  {:else if info}
    <p class="muted small">{t('programs.noneForClass')}</p>
  {/if}
  {#if picking}
    <select
      aria-label={t('programs.choose')}
      data-field="class-program"
      onchange={(e) => void choose(e.currentTarget.value || null)}
    >
      <option value="">{t('programs.choose')}</option>
      {#each choices as p (p.id)}<option value={p.id}>{p.title}</option>{/each}
    </select>
    {#if info?.program}
      <Button size="sm" variant="ghost" onclick={() => void choose(null)}
        >{t('programs.unset')}</Button
      >
    {/if}
  {:else}
    <div class="actions">
      <Button size="sm" variant="secondary" onclick={() => void openPicker()}>
        {info?.program ? t('programs.change') : t('programs.set')}
      </Button>
      <Button size="sm" variant="ghost" href="/teacher/programs">{t('programs.title')}</Button>
    </div>
  {/if}
  {#if actionFailed}
    <p class="failed small" role="alert">{t('common.error')}</p>
  {/if}
</Card>

<style>
  .title {
    margin: 0 0 var(--space-2);
  }
  .name {
    margin: 0;
    font-weight: 700;
  }
  .next {
    display: grid;
    gap: var(--space-1);
    margin-top: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-sm, 6px);
    background: var(--c-accent-soft);
  }
  .next span {
    font-size: var(--text-sm);
    color: var(--c-muted);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin-top: var(--space-2);
  }
  select {
    width: 100%;
    margin-top: var(--space-2);
    font: inherit;
    padding: var(--space-1) var(--space-2);
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
  .failed {
    margin: var(--space-2) 0 0;
    color: var(--c-danger);
  }
</style>
