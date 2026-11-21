<script lang="ts">
  import {
    ktpChangesOver,
    registerDate,
    type KtpLessonRef,
    type KtpPlan,
    type KtpRow,
  } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { i18n, t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';

  /**
   * One KTP (PLAN.md 5.2–5.3; stage 4, W10–W11): where the class is by the plan, the topics with
   * their lessons and "done", changes by hand against what the school allows, and the file back
   * in Excel.
   */
  let { params }: PageProps = $props();
  let plan = $state<KtpPlan | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  /** The lessons to choose from, loaded when the teacher first picks one. */
  let catalog = $state<KtpLessonRef[] | null>(null);
  let picking = $state<string | null>(null);
  let pickText = $state('');
  let editing = $state<string | null>(null);
  let draft = $state({ number: '', topic: '', hours: '', weekOrDate: '', note: '' });
  let newTopic = $state('');
  let newDate = $state('');

  const id = $derived(params.id ?? '');
  const suggestions = $derived(plan?.items.filter((i) => i.suggestion) ?? []);
  const next = $derived(plan?.items.find((i) => !i.isDone) ?? null);
  const delta = $derived(plan && plan.planned !== null ? plan.done - plan.planned : null);
  const changedPercent = $derived(
    plan && plan.changes.base > 0
      ? Math.round((plan.changes.changed * 100) / plan.changes.base)
      : 0,
  );

  function failed(e: unknown): void {
    if (e instanceof ApiError && e.status === 401) {
      router.navigate('/teacher/login', { replace: true });
      return;
    }
    error =
      e instanceof ApiError && e.status === 404
        ? t('common.notFound')
        : e instanceof ApiError && e.code === 'edit_on_platform'
          ? t('ktp.onPlatform')
          : t('common.error');
  }

  async function change(action: () => Promise<KtpPlan>): Promise<void> {
    busy = true;
    error = null;
    try {
      plan = await action();
    } catch (e) {
      failed(e);
    } finally {
      busy = false;
    }
  }

  const setDone = (row: KtpRow, isDone: boolean) =>
    change(() => api.updateKtpRow(id, row.id, { isDone }));
  const link = (row: KtpRow, lessonId: string | null) =>
    change(() => api.updateKtpRow(id, row.id, { lessonId }));
  const linkAll = () =>
    change(() =>
      api.linkKtp(id, {
        links: suggestions.flatMap((i) =>
          i.suggestion ? [{ rowId: i.id, lessonId: i.suggestion.id }] : [],
        ),
      }),
    );

  async function startPick(row: KtpRow): Promise<void> {
    picking = row.id;
    pickText = '';
    if (!catalog) {
      try {
        catalog = (await api.ktpLessons(id)).lessons;
      } catch (e) {
        failed(e);
      }
    }
  }

  function pick(row: KtpRow): void {
    const lesson = catalog?.find((l) => l.title === pickText.trim());
    if (!lesson) return;
    picking = null;
    void link(row, lesson.id);
  }

  function startEdit(row: KtpRow): void {
    editing = row.id;
    draft = {
      number: row.number,
      topic: row.topic,
      hours: row.hours === null ? '' : String(row.hours),
      weekOrDate: row.weekOrDate,
      note: row.note,
    };
  }

  function saveEdit(row: KtpRow, event: SubmitEvent): void {
    event.preventDefault();
    const hours = draft.hours.trim() === '' ? null : Number(draft.hours.replace(',', '.'));
    if (!draft.topic.trim() || (hours !== null && !(hours >= 0 && hours <= 20))) return;
    editing = null;
    void change(() =>
      api.updateKtpRow(id, row.id, {
        number: draft.number,
        topic: draft.topic,
        hours,
        weekOrDate: draft.weekOrDate,
        note: draft.note,
      }),
    );
  }

  function remove(row: KtpRow): void {
    if (!confirm(t('ktp.row.deleteConfirm', { topic: row.topic }))) return;
    void change(() => api.deleteKtpRow(id, row.id));
  }

  function add(event: SubmitEvent): void {
    event.preventDefault();
    if (!newTopic.trim() || !plan) return;
    const afterId = plan.items.at(-1)?.id ?? null;
    const row = {
      number: '',
      topic: newTopic.trim(),
      hours: null,
      weekOrDate: newDate.trim(),
      note: '',
    };
    newTopic = '';
    newDate = '';
    void change(() => api.addKtpRow(id, { afterId, row }));
  }

  onMount(async () => {
    try {
      plan = await api.ktp(id);
    } catch (e) {
      failed(e);
    }
  });
</script>

<Header back="/teacher/ktp" title={plan ? `${plan.className} · ${plan.title}` : t('ktp.title')} />

<main class="page stack">
  {#if error}<Notice kind="error">{error}</Notice>{/if}
  {#if plan}
    <PageHeader
      title={`${plan.className} · ${plan.title}`}
      subtitle={t('ktp.meta', { count: plan.rows, done: plan.done })}
    >
      {#snippet actions()}
        <Button
          variant="secondary"
          download
          href={`/api/ktp/${plan?.id ?? ''}/export.xlsx?lang=${i18n.locale}`}
        >
          {t('ktp.export')}
        </Button>
      {/snippet}
    </PageHeader>

    <!-- Where am I by the KTP (PLAN.md 5.3). -->
    <Card>
      <div class="where" data-where>
        <div class="bar" aria-hidden="true">
          <span class="fill" style:width={`${plan.rows ? (plan.done * 100) / plan.rows : 0}%`}
          ></span>
          {#if plan.planned !== null && plan.rows > 0}
            <span class="mark" style:left={`${(plan.planned * 100) / plan.rows}%`}></span>
          {/if}
        </div>
        <p>
          <b>{t('ktp.where.done', { done: plan.done, count: plan.rows })}</b>
          {#if plan.planned !== null && delta !== null}
            · {t('ktp.where.planned', { planned: plan.planned })} ·
            <span class:behind={delta < 0} class:ahead={delta > 0} data-delta={delta}>
              {delta < 0
                ? t('ktp.where.behind', { count: -delta })
                : delta > 0
                  ? t('ktp.where.ahead', { count: delta })
                  : t('ktp.where.onTrack')}
            </span>
          {:else}
            · <span class="muted">{t('ktp.where.noDates')}</span>
          {/if}
        </p>
        {#if next}
          <p class="next-topic">
            {t('ktp.where.next')}: <b>{next.number ? `${next.number}. ` : ''}{next.topic}</b>
            {#if next.lessonId}
              <Button size="sm" variant="secondary" href={`/teacher/lesson/${next.lessonId}`}>
                {t('ktp.lesson.open')}
              </Button>
            {/if}
          </p>
        {/if}
        <p class="small" class:over={ktpChangesOver(plan.changes)} data-changes>
          {t('ktp.changes', {
            changed: plan.changes.changed,
            base: plan.changes.base,
            percent: changedPercent,
            allowed: plan.changes.allowedPercent,
          })}
          {#if ktpChangesOver(plan.changes)}— {t('ktp.changes.over')}{/if}
        </p>
      </div>
    </Card>

    {#if suggestions.length > 0}
      <Notice>
        <span class="suggest">
          {t('ktp.suggest.found', { count: suggestions.length })}
          <Button size="sm" disabled={busy} onclick={linkAll}>{t('ktp.suggest.linkAll')}</Button>
        </span>
      </Notice>
    {/if}

    <Card>
      <datalist id="ktp-lessons">
        {#each catalog ?? [] as lesson (lesson.id)}<option value={lesson.title}></option>{/each}
      </datalist>
      <div class="wrap">
        <table>
          <thead>
            <tr>
              <th>{t('ktp.field.number')}</th>
              <th>{t('ktp.field.topic')}</th>
              <th>{t('ktp.field.hours')}</th>
              <th>{t('ktp.field.weekOrDate')}</th>
              <th>{t('ktp.lesson')}</th>
              <th>{t('ktp.done')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each plan.items as row (row.id)}
              <tr data-row={row.position} class:done={row.isDone} class:next={row.id === next?.id}>
                {#if editing === row.id}
                  <td colspan="7">
                    <form class="edit" onsubmit={(e) => saveEdit(row, e)}>
                      <input class="num" bind:value={draft.number} maxlength="12" />
                      <input class="grow" bind:value={draft.topic} maxlength="300" required />
                      <input
                        class="num"
                        bind:value={draft.hours}
                        inputmode="decimal"
                        placeholder={t('ktp.field.hours')}
                      />
                      <input
                        class="date"
                        bind:value={draft.weekOrDate}
                        maxlength="40"
                        placeholder={t('ktp.field.weekOrDate')}
                      />
                      <input
                        class="grow"
                        bind:value={draft.note}
                        maxlength="300"
                        placeholder={t('ktp.field.note')}
                      />
                      <Button size="sm" type="submit">{t('common.save')}</Button>
                      <Button size="sm" variant="ghost" onclick={() => (editing = null)}>
                        {t('common.cancel')}
                      </Button>
                    </form>
                  </td>
                {:else}
                  <td>{row.number}</td>
                  <td class="topic">
                    {row.topic}
                    {#if row.note}<div class="muted small">{row.note}</div>{/if}
                  </td>
                  <td>{row.hours ?? ''}</td>
                  <td>{row.weekOrDate}</td>
                  <td class="lesson">
                    {#if row.lessonId}
                      <a href={`/teacher/lesson/${row.lessonId}`}
                        >{row.lessonTitle ?? row.lessonId}</a
                      >
                      <button
                        type="button"
                        class="x"
                        title={t('ktp.lesson.unlink')}
                        aria-label={t('ktp.lesson.unlink')}
                        disabled={busy}
                        onclick={() => link(row, null)}>×</button
                      >
                    {:else if picking === row.id}
                      <span class="pick">
                        <input
                          list="ktp-lessons"
                          bind:value={pickText}
                          placeholder={t('ktp.lesson.search')}
                          onchange={() => pick(row)}
                          data-field="ktp-lesson"
                        />
                        <button
                          type="button"
                          class="x"
                          aria-label={t('common.cancel')}
                          onclick={() => (picking = null)}>×</button
                        >
                      </span>
                    {:else if row.suggestion}
                      <span class="muted small">{t('ktp.suggest.maybe')}</span>
                      <button
                        type="button"
                        class="link"
                        disabled={busy}
                        onclick={() => row.suggestion && link(row, row.suggestion.id)}
                        data-suggest={row.suggestion.id}
                      >
                        {row.suggestion.title}
                      </button>
                      <button type="button" class="link muted" onclick={() => startPick(row)}>
                        {t('ktp.lesson.other')}
                      </button>
                    {:else}
                      <button
                        type="button"
                        class="link"
                        onclick={() => startPick(row)}
                        data-choose={row.position}
                      >
                        {t('ktp.lesson.choose')}
                      </button>
                    {/if}
                  </td>
                  <td class="check">
                    <label>
                      <input
                        type="checkbox"
                        checked={row.isDone}
                        disabled={busy}
                        onchange={(e) => setDone(row, e.currentTarget.checked)}
                        data-done={row.position}
                      />
                      {#if row.isDone && row.doneAt}
                        <span class="muted small">{registerDate(row.doneAt.slice(0, 10))}</span>
                      {:else if row.heldAt}
                        <span class="held small" data-held={row.position}
                          >{t('ktp.held', { date: registerDate(row.heldAt.slice(0, 10)) })}</span
                        >
                      {/if}
                    </label>
                  </td>
                  <td>
                    <div class="actions">
                      <button
                        type="button"
                        class="link muted"
                        onclick={() => startEdit(row)}
                        data-edit={row.position}>{t('own.edit')}</button
                      >
                      <button type="button" class="link muted" onclick={() => remove(row)}
                        >{t('own.delete')}</button
                      >
                    </div>
                  </td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <form class="add" onsubmit={add}>
        <input
          class="grow"
          bind:value={newTopic}
          maxlength="300"
          placeholder={t('ktp.row.newTopic')}
          data-field="ktp-new-topic"
        />
        <input
          class="date"
          bind:value={newDate}
          maxlength="40"
          placeholder={t('ktp.field.weekOrDate')}
        />
        <Button size="sm" variant="secondary" type="submit" disabled={busy || !newTopic.trim()}>
          {t('ktp.row.add')}
        </Button>
      </form>
    </Card>
  {/if}
</main>

<style>
  .where p {
    margin: var(--space-2) 0 0;
  }
  .bar {
    position: relative;
    height: 10px;
    border-radius: var(--radius-pill);
    background: var(--c-line);
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: var(--radius-pill);
    background: var(--c-ok);
  }
  .mark {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    background: var(--c-dark);
  }
  .behind {
    color: var(--c-danger-strong);
    font-weight: 700;
  }
  .ahead {
    color: var(--c-ok);
    font-weight: 700;
  }
  .over {
    color: var(--c-danger-strong);
  }
  .next-topic {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
  }
  .suggest {
    display: inline-flex;
    gap: var(--space-3);
    align-items: center;
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
    padding: var(--space-2);
    border-bottom: 1px solid var(--c-line);
    vertical-align: top;
  }
  th {
    font-size: var(--text-sm);
    color: var(--c-muted);
  }
  tr.done .topic {
    color: var(--c-muted);
  }
  tr.next {
    background: var(--c-accent-soft);
  }
  .topic {
    min-width: 200px;
  }
  .lesson {
    min-width: 200px;
  }
  .check label {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
    white-space: nowrap;
  }
  .held {
    color: var(--c-accent-strong);
    font-weight: 600;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    align-items: flex-start;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--c-accent-strong);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }
  .x {
    border: 0;
    background: none;
    color: var(--c-muted);
    cursor: pointer;
    font-size: var(--text-lg);
    line-height: 1;
  }
  .pick {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
  }
  .edit input,
  .add input,
  .pick input {
    min-height: var(--control-sm);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius);
    background: var(--c-surface);
    color: var(--c-dark);
  }
  .edit,
  .add {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
  }
  .add {
    margin-top: var(--space-3);
  }
  .num {
    width: 5em;
  }
  .date {
    width: 9em;
  }
  .grow {
    flex: 1 1 200px;
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
</style>
