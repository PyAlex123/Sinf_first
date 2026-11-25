<script lang="ts">
  import { UpdateManifestSchema, type StoredUpdate } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../lib/api.js';
  import { formatSize } from '../lib/files.js';
  import { i18n, localeTag, t } from '../lib/i18n/index.svelte.js';
  import Button from '../lib/ui/Button.svelte';
  import Card from '../lib/ui/Card.svelte';
  import Notice from '../lib/ui/Notice.svelte';
  import Table from '../lib/ui/Table.svelte';

  /**
   * Updates of the Windows app in the superadmin's area (PLAN.md 6.11; stage 6, B6; ADR-023). CI
   * makes the artifact `Sinf-update-x64`: the installer and its signed `update.json`. Both go here;
   * the teachers' computers take the newest from the platform, the students' from their teacher.
   */

  let updates = $state<StoredUpdate[]>([]);
  let checksSignatures = $state(false);
  let manifestFile = $state<File | null>(null);
  let installerFile = $state<File | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let done = $state<string | null>(null);

  async function load(): Promise<void> {
    const list = await api.adminUpdates();
    updates = list.updates;
    checksSignatures = list.checksSignatures;
  }

  onMount(() => {
    void load().catch(() => (error = t('common.error')));
  });

  async function upload(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!manifestFile || !installerFile) return;
    error = null;
    done = null;
    let raw: unknown;
    try {
      raw = JSON.parse(await manifestFile.text());
    } catch {
      raw = null;
    }
    const manifest = UpdateManifestSchema.safeParse(raw);
    if (!manifest.success) {
      error = t('updates.badManifest');
      return;
    }
    if (installerFile.size !== manifest.data.size) {
      error = t('updates.otherFile', { file: manifest.data.file });
      return;
    }
    busy = true;
    try {
      const stored = await api.uploadUpdate(manifest.data, installerFile);
      done = t('updates.uploaded', { version: stored.version });
      await load();
    } catch (e) {
      error =
        e instanceof ApiError && ['bad_signature', 'bad_hash', 'bad_size'].includes(e.code)
          ? t(`updates.${e.code}`)
          : t('common.error');
    } finally {
      busy = false;
    }
  }

  async function remove(version: string): Promise<void> {
    if (!confirm(t('updates.confirmDelete', { version }))) return;
    await api.deleteUpdate(version);
    await load();
  }

  const date = (iso: string): string =>
    new Intl.DateTimeFormat(localeTag(i18n.locale), { dateStyle: 'medium' }).format(new Date(iso));
</script>

<Card>
  <h2>{t('updates.title')}</h2>
  <p class="muted small">{t('updates.hint')}</p>
  {#if !checksSignatures}<Notice kind="info">{t('updates.noKey')}</Notice>{/if}
  {#if error}<Notice kind="error">{error}</Notice>{/if}
  {#if done}<Notice kind="ok">{done}</Notice>{/if}

  {#if updates.length > 0}
    <Table>
      <tbody>
        {#each updates as u, i (u.version)}
          <tr data-update={u.version}>
            <td>
              <b>{u.version}</b>
              {#if i === 0}<span class="muted small"> · {t('updates.current')}</span>{/if}
              <div class="muted small">
                {u.file} · {formatSize(u.size, i18n.locale)} · {date(u.storedAt)}
              </div>
            </td>
            <td class="actions">
              <Button size="sm" variant="ghost" onclick={() => void remove(u.version)}
                >{t('updates.delete')}</Button
              >
            </td>
          </tr>
        {/each}
      </tbody>
    </Table>
  {:else}
    <p class="muted">{t('updates.none')}</p>
  {/if}

  <form onsubmit={upload} class="stack">
    <label class="file-field">
      <span>{t('updates.manifest')}</span>
      <input
        type="file"
        accept=".json,application/json"
        data-field="update-json"
        onchange={(e) => (manifestFile = e.currentTarget.files?.[0] ?? null)}
      />
    </label>
    <label class="file-field">
      <span>{t('updates.installer')}</span>
      <input
        type="file"
        accept=".exe"
        data-field="update-exe"
        onchange={(e) => (installerFile = e.currentTarget.files?.[0] ?? null)}
      />
    </label>
    <div>
      <Button type="submit" disabled={busy || !manifestFile || !installerFile}>
        {busy ? t('updates.uploading') : t('updates.upload')}
      </Button>
    </div>
  </form>
</Card>

<style>
  .file-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .actions {
    text-align: right;
  }
  form {
    margin-top: var(--space-4);
  }
</style>
