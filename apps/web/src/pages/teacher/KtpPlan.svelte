<script lang="ts">
  import type { KtpPlan } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { i18n, t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';

  /** One KTP (PLAN.md 5.2; stage 4, W10): its topics as imported, and the file back in Excel. */
  let { params }: PageProps = $props();
  let plan = $state<KtpPlan | null>(null);
  let error = $state<string | null>(null);

  async function load(): Promise<void> {
    try {
      plan = await api.ktp(params.id ?? '');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401)
        router.navigate('/teacher/login', { replace: true });
      else
        error =
          e instanceof ApiError && e.status === 404 ? t('common.notFound') : t('common.error');
    }
  }

  onMount(() => void load());
</script>

<Header back="/teacher/ktp" title={plan ? `${plan.className} · ${plan.title}` : t('ktp.title')} />

<main class="page stack">
  {#if error}<Notice kind="error">{error}</Notice>{/if}
  {#if plan}
    <PageHeader
      title={`${plan.className} · ${plan.title}`}
      subtitle={t('ktp.meta', { count: plan.rows, done: plan.done })}
    >
      {#snippet actions()}
        <Button
          variant="secondary"
          download
          href={`/api/ktp/${plan?.id ?? ''}/export.xlsx?lang=${i18n.locale}`}
        >
          {t('ktp.export')}
        </Button>
      {/snippet}
    </PageHeader>

    <Card>
      <div class="wrap">
        <table>
          <thead>
            <tr>
              <th>{t('ktp.field.number')}</th>
              <th>{t('ktp.field.topic')}</th>
              <th>{t('ktp.field.hours')}</th>
              <th>{t('ktp.field.weekOrDate')}</th>
              <th>{t('ktp.field.note')}</th>
            </tr>
          </thead>
          <tbody>
            {#each plan.items as row (row.id)}
              <tr data-row={row.position}>
                <td>{row.number}</td>
                <td class="topic">{row.topic}</td>
                <td>{row.hours ?? ''}</td>
                <td>{row.weekOrDate}</td>
                <td class="muted">{row.note}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </Card>
  {/if}
</main>

<style>
  .wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    text-align: left;
    padding: var(--space-2);
    border-bottom: 1px solid var(--c-line);
    vertical-align: top;
  }
  th {
    font-size: var(--text-sm);
    color: var(--c-muted);
  }
  .topic {
    min-width: 260px;
  }
  .muted {
    color: var(--c-muted);
  }
</style>
