<script lang="ts">
  import type { SchoolBrief } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import EmptyState from '../../lib/ui/EmptyState.svelte';
  import Field from '../../lib/ui/Field.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';

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

<main class="page mid stack">
  <PageHeader title={t('schools.title')} subtitle={t('schools.hint')} />

  {#if asked}
    <Notice kind="info">{t('schools.pending', { name: asked.name })}</Notice>
  {/if}
  {#if error}<Notice kind="error">{error}</Notice>{/if}

  <Card>
    <Field label={t('schools.search')}>
      <input type="search" bind:value={query} placeholder={t('schools.search')} />
    </Field>

    {#if found.length === 0}
      <div class="empty">
        <EmptyState icon="school" title={t('schools.none')} text={t('schools.noneHint')} />
      </div>
    {:else}
      <ul class="rows">
        {#each found as school (school.id)}
          <li>
            <span class="mark"><Icon name="school" /></span>
            <span class="who">
              <b>{school.name}</b>
              {#if school.city}<small class="muted">{school.city}</small>{/if}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy === school.id || asked !== null}
              onclick={() => ask(school)}
            >
              {t('schools.ask')}
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
  </Card>
</main>

<style>
  .empty {
    margin-top: var(--space-4);
  }
  .rows {
    list-style: none;
    margin: var(--space-4) 0 0;
    padding: 0;
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-top: 1px solid var(--c-line);
  }
  .mark {
    display: grid;
    place-items: center;
    width: var(--control-sm);
    height: var(--control-sm);
    border-radius: var(--radius);
    background: var(--c-bg-2);
    color: var(--c-muted);
    flex: none;
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
    color: var(--c-dark);
  }
  .who b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
