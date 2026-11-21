<script lang="ts">
  import type { KtpPlanSummary } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import EmptyState from '../../lib/ui/EmptyState.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';

  /** The teacher's KTPs (PLAN.md 5.2; stage 4, W10): one per class, imported from a file. */
  let { params: _params }: PageProps = $props();
  let plans = $state<KtpPlanSummary[]>([]);
  let loaded = $state(false);
  let error = $state<string | null>(null);

  async function load(): Promise<void> {
    try {
      plans = (await api.ktpList()).plans;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401)
        router.navigate('/teacher/login', { replace: true });
      else error = t('common.error');
    } finally {
      loaded = true;
    }
  }

  async function remove(plan: KtpPlanSummary): Promise<void> {
    if (!confirm(t('ktp.deleteConfirm', { title: plan.title, className: plan.className }))) return;
    try {
      plans = (await api.deleteKtp(plan.id)).plans;
    } catch {
      error = t('common.error');
    }
  }

  onMount(() => void load());
</script>

<Header back="/teacher" title={t('ktp.title')} />

<main class="page stack">
  <PageHeader title={t('ktp.title')} subtitle={t('ktp.subtitle')}>
    {#snippet actions()}
      <Button href="/teacher/ktp/import">{t('ktp.import')}</Button>
    {/snippet}
  </PageHeader>
  {#if error}<Notice kind="error">{error}</Notice>{/if}

  {#if loaded && plans.length === 0}
    <EmptyState title={t('ktp.none')} text={t('ktp.noneHint')} />
  {/if}
  <ul class="list">
    {#each plans as plan (plan.id)}
      <li data-ktp={plan.id}>
        <Card>
          <div class="row">
            <div class="info">
              <b>{plan.className} · {plan.title}</b>
              <div class="muted small">
                {t('ktp.meta', { count: plan.rows, done: plan.done })}
                {#if plan.sourceFile}· {plan.sourceFile}{/if}
              </div>
            </div>
            <Button size="sm" variant="secondary" href={`/teacher/ktp/${plan.id}`}>
              {t('teacher.lesson.open')}
            </Button>
            <Button size="sm" variant="ghost" onclick={() => remove(plan)}>{t('own.delete')}</Button
            >
          </div>
        </Card>
      </li>
    {/each}
  </ul>
</main>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    flex-wrap: wrap;
  }
  .info {
    flex: 1 1 240px;
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
</style>
