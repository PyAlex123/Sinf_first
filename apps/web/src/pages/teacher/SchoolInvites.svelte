<script lang="ts">
  import { registerDate, type SchoolInvite } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Notice from '../../lib/ui/Notice.svelte';

  /**
   * Links into the school (PLAN.md 2.3; stage 5, A6): the administrator makes one for a week and
   * sends it to the staff's chat. The link is shown once — the platform keeps only its hash.
   */
  let { schoolId }: { schoolId: string } = $props();

  let invites = $state<SchoolInvite[]>([]);
  let fresh = $state<string | null>(null);
  let copied = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  function failed(e: unknown): void {
    error =
      e instanceof ApiError && e.code === 'edit_on_platform'
        ? t('invite.onPlatform')
        : t('common.error');
  }

  async function make(): Promise<void> {
    busy = true;
    error = null;
    copied = false;
    try {
      const res = await api.createInvite(schoolId);
      fresh = `${location.origin}/invite/${res.token}`;
      invites = [res.invite, ...invites];
    } catch (e) {
      failed(e);
    } finally {
      busy = false;
    }
  }

  async function copy(): Promise<void> {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      copied = true;
    } catch {
      // Without the clipboard (an old browser, no HTTPS) the link is still there to select.
    }
  }

  async function revoke(invite: SchoolInvite): Promise<void> {
    if (!confirm(t('invite.revokeConfirm'))) return;
    try {
      invites = (await api.revokeInvite(schoolId, invite.id)).invites;
      fresh = null;
    } catch (e) {
      failed(e);
    }
  }

  onMount(async () => {
    try {
      invites = (await api.invites(schoolId)).invites;
    } catch (e) {
      failed(e);
    }
  });
</script>

<Card>
  <h2>{t('invite.adminTitle')}</h2>
  <p class="muted small">{t('invite.adminHint')}</p>
  {#if error}<Notice kind="error">{error}</Notice>{/if}
  <Button onclick={make} disabled={busy}>{t('invite.make')}</Button>
  {#if fresh}
    <div class="fresh">
      <input readonly value={fresh} onfocus={(e) => e.currentTarget.select()} data-invite-link />
      <Button variant="secondary" size="sm" onclick={copy}>
        {copied ? t('invite.copied') : t('invite.copy')}
      </Button>
    </div>
    <p class="muted small">{t('invite.once')}</p>
  {/if}
  {#if invites.length > 0}
    <ul class="list">
      {#each invites as invite (invite.id)}
        <li data-invite={invite.id}>
          <span>
            {t('invite.until', { date: registerDate(invite.expiresAt.slice(0, 10)) })} ·
            {t('invite.used', { count: invite.used })} ·
            <span class="muted">{invite.createdByName}</span>
          </span>
          <Button variant="danger-ghost" size="sm" onclick={() => revoke(invite)}>
            {t('invite.revoke')}
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
</Card>

<style>
  .fresh {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    margin-top: var(--space-3);
  }
  .fresh input {
    flex: 1 1 auto;
    min-height: var(--control-sm);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius);
    background: var(--c-bg-2, var(--c-surface));
    color: var(--c-dark);
    font-family: ui-monospace, monospace;
    font-size: var(--text-sm);
  }
  .list {
    list-style: none;
    margin: var(--space-3) 0 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }
  .list li {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
</style>
