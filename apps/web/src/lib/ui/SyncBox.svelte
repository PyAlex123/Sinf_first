<script lang="ts">
  import type { SyncStatus } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api } from '../api.js';
  import { i18n, localeTag, t } from '../i18n/index.svelte.js';
  import Badge from './Badge.svelte';
  import Button from './Button.svelte';
  import Card from './Card.svelte';
  import Icon from './Icon.svelte';

  /**
   * On a school computer: did the lessons reach the platform (S2.6)? On the platform itself this
   * shows nothing at all — there is nothing to send there.
   */
  let status = $state<SyncStatus | null>(null);
  let busy = $state(false);

  const time = (iso: string): string =>
    new Date(iso).toLocaleString(localeTag(i18n.locale), {
      dateStyle: 'short',
      timeStyle: 'short',
    });

  /** "offline" is not a fault: the line above already says the lessons are waiting. */
  const problem = $derived(
    status?.lastError && status.lastError !== 'offline' ? status.lastError : null,
  );

  async function load(): Promise<void> {
    try {
      status = await api.syncStatus();
    } catch {
      // Syncing is not what the teacher came here for: a failure here stays quiet.
    }
  }

  async function sendNow(): Promise<void> {
    busy = true;
    try {
      status = await api.syncNow();
    } catch {
      // Same: the next tick will try again by itself.
    } finally {
      busy = false;
    }
  }

  onMount(() => void load());
</script>

{#if status && status.mode === 'school'}
  <Card muted>
    <h3>{t('sync.title')}</h3>
    <p class="state">
      {#if status.pending === 0 && status.pendingShots > 0}
        <Badge tone="warn">{t('sync.shots', { count: status.pendingShots })}</Badge>
      {:else if status.pending === 0}
        <Badge tone="ok">{t('sync.allSent')}</Badge>
      {:else}
        <Badge tone="warn">{t('sync.pending', { count: status.pending })}</Badge>
      {/if}
    </p>
    <p class="muted small">
      {status.lastSyncAt ? t('sync.lastSync', { time: time(status.lastSyncAt) }) : t('sync.never')}
    </p>
    {#if problem}
      <p class="muted small">{t('sync.error', { text: problem })}</p>
    {/if}
    {#if status.pending > 0 || status.pendingShots > 0}
      <Button variant="secondary" size="sm" disabled={busy} onclick={sendNow}>
        <Icon name="forward" size={16} />
        {t('sync.now')}
      </Button>
    {/if}
  </Card>
{/if}

<style>
  .state {
    margin: var(--space-2) 0;
  }
</style>
