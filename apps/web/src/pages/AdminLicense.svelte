<script lang="ts">
  import { registerDate, type AdminSchool, type License } from '@sinf/shared';
  import { api } from '../lib/api.js';
  import { t } from '../lib/i18n/index.svelte.js';
  import Badge from '../lib/ui/Badge.svelte';
  import Button from '../lib/ui/Button.svelte';

  /**
   * A school's license in the superadmin's area (PLAN.md 2.7; stage 6, B2): where it stands, a new
   * one for N classes and a period, the old ones to take back.
   */
  let { school, onchange }: { school: AdminSchool; onchange: () => void } = $props();

  let open = $state(false);
  let licenses = $state<License[]>([]);
  let limit = $state(10);
  let from = $state(new Date().toISOString().slice(0, 10));
  let to = $state(`${new Date().getFullYear() + (new Date().getMonth() >= 8 ? 1 : 0)}-05-31`);
  let note = $state('');
  let error = $state<string | null>(null);

  const tone = $derived(
    school.license.status === 'active'
      ? 'ok'
      : school.license.status === 'grace' || school.license.status === 'future'
        ? 'warn'
        : 'danger',
  );

  async function toggle(): Promise<void> {
    open = !open;
    if (open) licenses = (await api.licenses(school.id)).licenses;
  }

  async function issue(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = null;
    try {
      licenses = (
        await api.issueLicense(school.id, {
          classesLimit: Number(limit),
          validFrom: from,
          validTo: to,
          note,
        })
      ).licenses;
      onchange();
    } catch {
      error = t('common.error');
    }
  }

  async function revoke(license: License): Promise<void> {
    if (!confirm(t('license.revokeConfirm'))) return;
    licenses = (await api.revokeLicense(school.id, license.id)).licenses;
    onchange();
  }
</script>

<div class="license" data-license={school.name}>
  <Badge {tone}>{t(`license.status.${school.license.status}`)}</Badge>
  {#if school.license.terms}
    <span class="small">
      {t('license.terms', {
        used: school.license.classesUsed,
        limit: school.license.terms.classesLimit,
        to: registerDate(school.license.terms.validTo),
      })}
    </span>
  {/if}
  <Button size="sm" variant="ghost" onclick={toggle}>{t('license.manage')}</Button>
</div>
{#if open}
  <form class="issue" onsubmit={issue}>
    <label
      >{t('license.classes')}
      <input type="number" min="1" max="500" bind:value={limit} data-field="license-limit" /></label
    >
    <label
      >{t('report.from')}
      <input type="date" bind:value={from} required data-field="license-from" /></label
    >
    <label
      >{t('report.to')}
      <input type="date" bind:value={to} required data-field="license-to" /></label
    >
    <label class="grow">{t('license.note')} <input bind:value={note} maxlength="200" /></label>
    <Button size="sm" type="submit">{t('license.issue')}</Button>
  </form>
  {#if error}<p class="error small">{error}</p>{/if}
  <ul class="list">
    {#each licenses as l (l.id)}
      <li class:revoked={!!l.revokedAt}>
        {t('license.row', {
          limit: l.classesLimit,
          from: registerDate(l.validFrom),
          to: registerDate(l.validTo),
        })}
        {#if l.note}<span class="muted">· {l.note}</span>{/if}
        {#if !l.revokedAt}
          <Button size="sm" variant="danger-ghost" onclick={() => revoke(l)}
            >{t('license.revoke')}</Button
          >
        {:else}
          <span class="muted">· {t('license.revoked')}</span>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .license {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
    margin-top: var(--space-1);
  }
  .issue {
    display: flex;
    gap: var(--space-2);
    align-items: end;
    flex-wrap: wrap;
    margin-top: var(--space-2);
  }
  .issue label {
    display: grid;
    gap: 2px;
    font-size: var(--text-sm);
  }
  .issue input {
    min-height: var(--control-sm);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius);
    background: var(--c-surface);
    color: var(--c-dark);
  }
  .issue input[type='number'] {
    width: 6em;
  }
  .grow {
    flex: 1 1 160px;
  }
  .list {
    list-style: none;
    margin: var(--space-2) 0 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
    font-size: var(--text-sm);
  }
  .list li {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
  }
  .revoked {
    color: var(--c-muted);
    text-decoration: line-through;
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
  .error {
    color: var(--c-danger-strong);
  }
</style>
