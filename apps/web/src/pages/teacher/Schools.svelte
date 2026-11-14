<script lang="ts">
  import type { SchoolBrief } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';

  /** Finding your own school and asking to join (S2.3): the administrator decides. */

  let { params: _params }: PageProps = $props();
  let schools = $state<SchoolBrief[]>([]);
  let query = $state('');
  let error = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let asked = $state<SchoolBrief | null>(null);

  const found = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return schools;
    return schools.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.city ?? '').toLowerCase().includes(q),
    );
  });

  async function load(): Promise<void> {
    try {
      const [list, me] = await Promise.all([api.schools(), api.me()]);
      schools = list.schools;
      asked = me.pendingSchool;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.navigate('/teacher/login', { replace: true });
        return;
      }
      error = t('common.error');
    }
  }

  async function ask(school: SchoolBrief): Promise<void> {
    busy = school.id;
    error = null;
    try {
      await api.requestSchool(school.id);
      asked = school;
    } catch (e) {
      error =
        e instanceof ApiError && e.code === 'already_member'
          ? t('schools.alreadyMember')
          : e instanceof ApiError && e.code === 'request_pending'
            ? t('schools.pendingOther')
            : t('common.error');
    } finally {
      busy = null;
    }
  }

  onMount(() => void load());
</script>

<Header back="/teacher" />

<main class="page narrow">
  <Card>
    <h1>{t('schools.title')}</h1>
    <p class="muted">{t('schools.hint')}</p>
    {#if asked}
      <Notice kind="info">{t('schools.pending', { name: asked.name })}</Notice>
    {/if}
    {#if error}<Notice kind="error">{error}</Notice>{/if}
    <input
      type="search"
      bind:value={query}
      placeholder={t('schools.search')}
      aria-label={t('schools.search')}
    />
  </Card>

  {#if found.length === 0}
    <p class="muted">{t('schools.none')}</p>
  {:else}
    <ul class="rows">
      {#each found as school (school.id)}
        <li>
          <span class="who">
            <b>{school.name}</b>
            {#if school.city}<small class="muted">{school.city}</small>{/if}
          </span>
          <Button
            variant="secondary"
            size="md"
            disabled={busy === school.id || asked !== null}
            onclick={() => ask(school)}
          >
            {t('schools.ask')}
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .narrow {
    max-width: 680px;
  }
  input {
    width: 100%;
    min-height: 44px;
    margin-top: var(--space-3);
    padding: 0 var(--space-3);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    font-size: var(--text-md);
  }
  .rows {
    list-style: none;
    margin: var(--space-4) 0;
    padding: 0;
    background: var(--c-surface);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .rows li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--c-line);
  }
  .who {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    color: var(--c-dark);
  }
</style>
