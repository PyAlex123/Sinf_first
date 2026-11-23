<script lang="ts">
  import type { PilotRequest } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { i18n, localeTag, t } from '../lib/i18n/index.svelte.js';
  import Badge from '../lib/ui/Badge.svelte';
  import Button from '../lib/ui/Button.svelte';
  import Card from '../lib/ui/Card.svelte';

  /** Requests for a pilot from the landing page (PLAN.md 8.4; B10): new ones first, then handled. */
  let requests = $state<PilotRequest[]>([]);
  let error = $state(false);

  async function load(): Promise<void> {
    try {
      requests = (await api.pilotRequests()).requests;
      error = false;
    } catch {
      error = true;
    }
  }

  async function toggle(r: PilotRequest): Promise<void> {
    try {
      await api.markPilotRequest(r.id);
      await load();
    } catch {
      error = true;
    }
  }

  const date = (iso: string): string =>
    new Intl.DateTimeFormat(localeTag(i18n.locale), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));

  onMount(() => void load());
</script>

<Card>
  <h2>{t('pilot.admin.title')}</h2>
  {#if error}<p class="muted">{t('common.error')}</p>{/if}
  {#if requests.length === 0}
    <p class="muted">{t('pilot.admin.none')}</p>
  {/if}
  <ul class="list">
    {#each requests as r (r.id)}
      <li data-pilot-request={r.school} class:handled={!!r.handledAt}>
        <div class="head">
          <b>{r.school}</b>
          <span class="muted small">· {r.city} · {date(r.createdAt)}</span>
          {#if !r.handledAt}<Badge tone="warn">{t('pilot.admin.new')}</Badge>{/if}
        </div>
        <p>
          {r.name} — <b>{r.contact}</b>
          {#if r.classes}<span class="muted">
              · {t('pilot.admin.classes', { count: r.classes })}</span
            >{/if}
        </p>
        {#if r.comment}<p class="comment">«{r.comment}»</p>{/if}
        <Button size="sm" variant={r.handledAt ? 'ghost' : 'secondary'} onclick={() => toggle(r)}>
          {r.handledAt ? t('pilot.admin.reopen') : t('pilot.admin.handled')}
        </Button>
      </li>
    {/each}
  </ul>
</Card>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }
  li {
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    padding: var(--space-3) var(--space-4);
  }
  li.handled {
    opacity: 0.65;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-1);
  }
  p {
    margin: 0 0 var(--space-2);
  }
  .comment {
    color: var(--c-text);
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
</style>
