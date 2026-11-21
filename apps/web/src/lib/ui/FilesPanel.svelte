<script lang="ts">
  import {
    PREVIEWABLE_EXTENSIONS,
    extensionOf,
    type StudentFile,
    type StudentFilesResponse,
  } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { ApiError } from '../api.js';
  import {
    deleteFile,
    downloadFile,
    formatSize,
    listFiles,
    previewUrl,
    uploadFile,
    uploadProblem,
    type FilesAccess,
  } from '../files.js';
  import { i18n, t } from '../i18n/index.svelte.js';
  import Button from './Button.svelte';
  import EmptyState from './EmptyState.svelte';
  import Notice from './Notice.svelte';

  /**
   * "Мои работы" (H12): the files of one child, for the child (lesson or home) or their teacher.
   * The child may upload and delete; the teacher only looks and downloads.
   */
  let { access, readOnly = false }: { access: FilesAccess; readOnly?: boolean } = $props();

  let folder = $state<StudentFilesResponse | null>(null);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let busy = $state(false);
  let picker = $state<HTMLInputElement | null>(null);
  let preview = $state<{ name: string; url: string } | null>(null);

  const usedPercent = $derived(
    folder ? Math.min(100, Math.round((100 * folder.usedBytes) / folder.quotaBytes)) : 0,
  );
  const date = (iso: string): string =>
    new Date(iso).toLocaleString(i18n.locale === 'uz' ? 'uz-UZ' : 'ru-RU', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  const failure = (e: unknown): string =>
    e instanceof ApiError && e.code === 'quota'
      ? t('files.bad.quota')
      : e instanceof ApiError && e.code.startsWith('bad_name_')
        ? t(`files.bad.${e.code.slice('bad_name_'.length)}`)
        : e instanceof ApiError && e.code === 'too_large'
          ? t('files.bad.size')
          : t('common.error');

  async function load(): Promise<void> {
    try {
      // A problem with one of the files just sent stays on screen; the list only refreshes.
      folder = await listFiles(access);
    } catch (e) {
      error = e instanceof ApiError && e.status === 401 ? t('files.loginAgain') : t('common.error');
    }
  }

  async function upload(files: FileList | null): Promise<void> {
    if (!files || files.length === 0 || busy) return;
    busy = true;
    notice = null;
    error = null;
    try {
      for (const file of files) {
        const problem = uploadProblem(file);
        if (problem) {
          error = `${file.name}: ${t(problem)}`;
          continue;
        }
        // Saving a file with a name that is already there replaces it: that is what a child means.
        const same = folder?.files.find(
          (f) => f.name.toLowerCase() === file.name.normalize('NFC').toLowerCase(),
        );
        try {
          const result = await uploadFile(access, file, same?.sha256);
          if (result.conflictWith) {
            notice = t('files.conflict', { name: result.file.name });
          }
        } catch (e) {
          error = `${file.name}: ${failure(e)}`;
        }
      }
      await load();
    } finally {
      busy = false;
      if (picker) picker.value = '';
    }
  }

  async function remove(file: StudentFile): Promise<void> {
    if (!confirm(t('files.confirmDelete', { name: file.name }))) return;
    busy = true;
    try {
      folder = await deleteFile(access, file);
    } catch {
      error = t('common.error');
    } finally {
      busy = false;
    }
  }

  async function download(file: StudentFile): Promise<void> {
    try {
      await downloadFile(access, file);
    } catch {
      error = t('common.error');
    }
  }

  async function look(file: StudentFile): Promise<void> {
    closePreview();
    try {
      preview = { name: file.name, url: await previewUrl(access, file) };
    } catch {
      error = t('common.error');
    }
  }

  function closePreview(): void {
    if (preview) URL.revokeObjectURL(preview.url);
    preview = null;
  }

  onMount(() => {
    void load();
    return closePreview;
  });
</script>

<section class="files stack">
  {#if error}<Notice kind="error">{error}</Notice>{/if}
  {#if notice}<Notice kind="warn">{notice}</Notice>{/if}

  {#if !folder}
    {#if !error}<p class="muted" aria-busy="true">{t('common.loading')}</p>{/if}
  {:else}
    <div class="bar">
      <div
        class="usage"
        title={t('files.used', {
          used: formatSize(folder.usedBytes, i18n.locale),
          quota: formatSize(folder.quotaBytes, i18n.locale),
        })}
      >
        <div class="fill" style:width="{usedPercent}%"></div>
      </div>
      <span class="muted small">
        {t('files.used', {
          used: formatSize(folder.usedBytes, i18n.locale),
          quota: formatSize(folder.quotaBytes, i18n.locale),
        })}
      </span>
      {#if !readOnly}
        <input
          bind:this={picker}
          class="picker"
          type="file"
          multiple
          onchange={(e) => void upload(e.currentTarget.files)}
        />
        <Button size="sm" disabled={busy} onclick={() => picker?.click()}>
          {busy ? t('files.uploading') : t('files.upload')}
        </Button>
      {/if}
    </div>

    {#if folder.files.length === 0}
      <EmptyState
        icon="star"
        title={t('files.empty')}
        text={readOnly ? '' : t('files.empty.hint')}
      />
    {:else}
      <ul class="list">
        {#each folder.files as file (file.id)}
          <li>
            <div class="name">
              <b>{file.name}</b>
              <span class="muted small">
                {formatSize(file.size, i18n.locale)} · {date(file.updatedAt)} · {file.origin}
              </span>
            </div>
            <div class="acts">
              {#if PREVIEWABLE_EXTENSIONS.includes(extensionOf(file.name))}
                <Button variant="ghost" size="sm" onclick={() => look(file)}
                  >{t('files.look')}</Button
                >
              {/if}
              <Button variant="ghost" size="sm" onclick={() => download(file)}>
                {t('files.download')}
              </Button>
              {#if !readOnly}
                <Button
                  variant="danger-ghost"
                  size="sm"
                  disabled={busy}
                  onclick={() => remove(file)}
                >
                  {t('files.delete')}
                </Button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  {#if preview}
    <figure class="preview">
      <img src={preview.url} alt={preview.name} />
      <figcaption>
        {preview.name}
        <Button variant="ghost" size="sm" onclick={closePreview}>{t('common.close')}</Button>
      </figcaption>
    </figure>
  {/if}
</section>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .usage {
    width: 140px;
    height: 8px;
    border-radius: 4px;
    background: var(--c-bg-2);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--c-accent);
  }
  .picker {
    display: none;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--c-line);
    border-radius: var(--radius-lg);
    background: var(--c-surface);
  }
  .list li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--c-line);
  }
  .list li:first-child {
    border-top: none;
  }
  .name {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1 1 220px;
  }
  .name b {
    overflow-wrap: anywhere;
  }
  .acts {
    display: flex;
    gap: var(--space-1);
    flex-shrink: 0;
  }
  .preview {
    margin: 0;
  }
  .preview img {
    max-width: 100%;
    max-height: 70vh;
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: #fff;
  }
  .preview figcaption {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    margin-top: var(--space-2);
  }
</style>
