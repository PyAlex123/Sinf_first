<script lang="ts">
  import type { SessionKtpResponse } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';

  /**
   * After a lesson (PLAN.md 5.3; stage 4, W11): the KTP topic it covered, marked done with one
   * click — the system offers, the teacher confirms. Nothing shows when the class has no KTP.
   */
  let { sessionId, lessonId }: { sessionId: string; lessonId: string } = $props();
  let ktp = $state<SessionKtpResponse['ktp']>(null);
  let busy = $state(false);
  let failed = $state(false);

  async function markDone(): Promise<void> {
    const offer = ktp;
    if (!offer?.row) return;
    busy = true;
    failed = false;
    try {
      // A topic offered as "the next one" gets this lesson too: next time it is found by itself.
      const plan = await api.updateKtpRow(offer.planId, offer.row.id, {
        isDone: true,
        ...(offer.linked ? {} : { lessonId }),
      });
      const row = plan.items.find((i) => i.id === offer.row?.id) ?? null;
      ktp = { ...offer, row, linked: true };
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
  }

  onMount(async () => {
    try {
      ktp = (await api.sessionKtp(sessionId)).ktp;
    } catch {
      // The KTP is a convenience here: the results stand without it.
    }
  });
</script>

{#if ktp?.row}
  <Card>
    <div class="ktp" data-ktp-box>
      <div class="text">
        <span class="muted small">{t('ktp.session.title', { title: ktp.planTitle })}</span>
        <b>{ktp.row.number ? `${ktp.row.number}. ` : ''}{ktp.row.topic}</b>
        {#if !ktp.linked}<span class="muted small">{t('ktp.session.next')}</span>{/if}
      </div>
      {#if ktp.row.isDone}
        <span class="ok" data-ktp-done>✓ {t('ktp.session.done')}</span>
      {:else}
        <Button size="sm" disabled={busy} onclick={markDone}>{t('ktp.session.mark')}</Button>
      {/if}
      <Button size="sm" variant="ghost" href={`/teacher/ktp/${ktp.planId}`}>
        {t('ktp.title')}
      </Button>
    </div>
    {#if failed}<p class="error small">{t('common.error')}</p>{/if}
  </Card>
{/if}

<style>
  .ktp {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    flex-wrap: wrap;
  }
  .text {
    flex: 1 1 260px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ok {
    color: var(--c-ok);
    font-weight: 700;
  }
  .error {
    color: var(--c-danger-strong);
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
</style>
