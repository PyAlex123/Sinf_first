<script lang="ts">
  import {
    PRACTICE_FILE_EXTENSIONS,
    type CheckOutcome,
    type PracticeCheckState,
    type PracticeTask,
  } from '@sinf/shared';
  import {
    downloadFile,
    listFiles,
    uploadFailureKey,
    uploadFile,
    uploadProblem,
    type FilesAccess,
  } from '../files.js';
  import { i18n, t } from '../i18n/index.svelte.js';
  import Icon from './Icon.svelte';

  /**
   * The practice of a lesson in a real program, as the child sees it (CLAUDE.md §4.7; H16): what to
   * do, the check-list (when the teacher turned it on) and, in a browser, the template to download
   * and the finished file to hand in. In the classroom app the program opens the file itself and
   * every Ctrl+S is checked on the teacher's computer.
   */
  let {
    task,
    check,
    access,
    classroom,
    onOpen,
  }: {
    task: PracticeTask;
    check: PracticeCheckState | null;
    access: FilesAccess | null;
    classroom: boolean;
    onOpen?: () => void;
  } = $props();

  let open = $state(true);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let input = $state<HTMLInputElement | null>(null);

  // A text-like practice takes any of its kinds; the others only their own file.
  const accept = $derived(
    task.app === 'notepad' || task.app === 'browser' || task.app === 'paint'
      ? undefined
      : PRACTICE_FILE_EXTENSIONS[task.app].map((e) => `.${e}`).join(','),
  );
  const outcome = (id: string): CheckOutcome | null => check?.outcomes[id] ?? null;
  const label = (c: PracticeTask['criteria'][number]): string => c.label[i18n.contentLocale];

  async function download(): Promise<void> {
    if (!access) return;
    error = null;
    try {
      const { files } = await listFiles(access);
      const file = files.find((f) => f.name === task.fileName);
      if (!file) {
        error = t('lessonPractice.noTemplate');
        return;
      }
      await downloadFile(access, file);
    } catch {
      error = t('common.error');
    }
  }

  async function handIn(file: File): Promise<void> {
    if (!access) return;
    busy = true;
    error = null;
    try {
      // Kept under the practice's own name over the version it came from: the downloaded copy
      // may be called "Документ (1).docx" by the browser, and the work is still the same work.
      const { files, maxFileBytes } = await listFiles(access);
      // The school's limit comes with the folder (A2).
      const problem = uploadProblem(file, maxFileBytes);
      if (problem) {
        error = t(problem.key, problem.params);
        return;
      }
      const there = files.find((f) => f.name === task.fileName);
      await uploadFile(access, file, there?.sha256 ?? undefined, task.fileName);
    } catch (e) {
      error = t(uploadFailureKey(e));
    } finally {
      busy = false;
      if (input) input.value = '';
    }
  }
</script>

<section class="practice" class:closed={!open} aria-label={t('lessonPractice.title')}>
  <header>
    <button type="button" class="toggle" aria-expanded={open} onclick={() => (open = !open)}>
      <b>{t('lessonPractice.title')}</b>
      {#if check}
        <span class="score" data-score
          >{t('lessonPractice.score', { passed: check.passed, total: check.total })}</span
        >
      {/if}
    </button>
  </header>
  {#if open}
    <p class="file">{task.fileName}</p>
    {#if classroom}
      <button type="button" class="main" onclick={() => onOpen?.()}>
        <Icon name="screen" size={18} />
        {t('lessonPractice.open', { app: t(`practice.app.${task.app}`) })}
      </button>
    {:else if access}
      <div class="row">
        <button type="button" class="ghost" onclick={() => void download()}>
          {t('lessonPractice.download')}
        </button>
        <label class="main" class:busy>
          {busy ? t('files.uploading') : t('lessonPractice.handIn')}
          <input
            bind:this={input}
            type="file"
            {accept}
            disabled={busy}
            onchange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) void handIn(f);
            }}
          />
        </label>
      </div>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if check && check.file !== 'ok'}
      <p class="warn">{t(`practice.file.${check.file}`)}</p>
    {:else if !check}
      <p class="hint">
        {classroom ? t('lessonPractice.saveHint') : t('lessonPractice.uploadHint')}
      </p>
    {/if}
    {#if task.showChecklist}
      <ul class="list">
        {#each task.criteria as c (c.id)}
          {@const o = c.kind === 'auto' ? outcome(c.id) : null}
          <li class={o ?? (c.kind === 'manual' ? 'manual' : 'wait')} data-criterion={c.id}>
            <span class="mark" aria-hidden="true">
              {#if o === 'pass'}✓{:else if o === 'fail'}✗{:else if c.kind === 'manual'}👁{:else}…{/if}
            </span>
            <span class="what">
              {label(c)}
              {#if c.kind === 'manual'}<em>{t('lessonPractice.teacherLooks')}</em>{/if}
              {#if o === 'unknown'}<em>{t('practice.outcome.unknown')}</em>{/if}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .practice {
    position: fixed;
    top: var(--space-3);
    right: var(--space-3);
    z-index: 30;
    width: min(360px, calc(100vw - 2 * var(--space-3)));
    max-height: calc(100vh - 220px);
    overflow: auto;
    padding: var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--c-surface);
    box-shadow: var(--shadow-lg);
  }
  .practice.closed {
    width: auto;
  }
  .toggle {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: var(--c-dark);
    text-align: left;
  }
  .score {
    padding: 2px var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--c-teal);
    color: #fff;
    font-weight: 700;
    white-space: nowrap;
  }
  .file {
    margin: var(--space-2) 0;
    font-weight: 600;
    word-break: break-word;
  }
  .row {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .main,
  .ghost {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control);
    padding: 0 var(--space-3);
    border-radius: var(--radius-pill);
    font-weight: 700;
    cursor: pointer;
  }
  .main {
    border: 0;
    background: var(--c-accent);
    color: #fff;
  }
  .main.busy {
    opacity: 0.7;
  }
  .main input {
    display: none;
  }
  .ghost {
    border: 1px solid var(--c-field-line);
    background: var(--c-surface);
    color: var(--c-dark);
  }
  .hint,
  .warn,
  .error {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
  }
  .hint {
    color: var(--c-muted);
  }
  .warn,
  .error {
    color: var(--c-danger);
  }
  .list {
    list-style: none;
    margin: var(--space-3) 0 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }
  .list li {
    display: grid;
    grid-template-columns: 1.2em 1fr;
    gap: var(--space-2);
    align-items: baseline;
  }
  .list em {
    margin-left: var(--space-1);
    font-size: var(--text-sm);
    color: var(--c-muted);
  }
  .mark {
    width: 1.2em;
    font-weight: 800;
  }
  .pass .mark {
    color: var(--c-ok);
  }
  .fail .mark {
    color: var(--c-danger);
  }
</style>
