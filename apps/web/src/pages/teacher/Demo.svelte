<script lang="ts">
  import type { DemoStatus } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Field from '../../lib/ui/Field.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';

  /**
   * The demo page (S1.15): virtual students for the running lesson of class 1А, and the demo reset.
   * The demo teacher's alone — anybody else gets "not found", as for anything not theirs.
   */

  let { params: _params }: PageProps = $props();

  let status = $state<DemoStatus | null>(null);
  let error = $state<string | null>(null);
  let message = $state<string | null>(null);
  let busy = $state(false);
  let howMany = $state(15);

  const room = $derived(status ? status.virtualMax - status.virtualInSession : 0);

  async function load(): Promise<void> {
    try {
      status = await api.demoStatus();
      howMany = Math.max(1, Math.min(howMany, room || 1));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.navigate('/teacher/login', { replace: true });
        return;
      }
      error = e instanceof ApiError && e.status === 404 ? t('common.notFound') : t('common.error');
    }
  }

  async function add(): Promise<void> {
    if (!status?.session) return;
    busy = true;
    message = null;
    error = null;
    try {
      status = await api.addVirtual({ sessionId: status.session.id, count: howMany });
      message = t('demo.virtual.added');
    } catch {
      error = t('common.error');
    } finally {
      busy = false;
    }
  }

  async function reset(): Promise<void> {
    if (!confirm(t('demo.reset.confirm'))) return;
    busy = true;
    message = null;
    error = null;
    try {
      await api.resetDemo();
      message = t('demo.reset.done');
      await load();
    } catch {
      error = t('common.error');
    } finally {
      busy = false;
    }
  }

  onMount(() => void load());
</script>

<Header back="/teacher" />

<main class="page mid stack">
  {#if error && !status}
    <Notice kind="error">{error}</Notice>
  {:else if !status}
    <p aria-busy="true" class="muted">{t('common.loading')}</p>
  {:else}
    <PageHeader title={t('demo.title')} subtitle={t('demo.subtitle')} />
    {#if message}<Notice kind="ok">{message}</Notice>{/if}
    {#if error}<Notice kind="error">{error}</Notice>{/if}

    <Card>
      <h2>{t('demo.virtual.title')}</h2>
      <p class="muted small">{t('demo.virtual.hint')}</p>
      {#if !status.session}
        <Notice>{t('demo.virtual.noSession')}</Notice>
      {:else}
        <p class="now">
          {t('demo.virtual.session', {
            title: status.session.lessonTitle,
            count: status.virtualInSession,
            max: status.virtualMax,
          })}
        </p>
        {#if room > 0}
          <div class="row add">
            <Field label={t('demo.virtual.count')}>
              <input type="number" min="1" max={room} bind:value={howMany} class="count" />
            </Field>
            <Button disabled={busy || howMany < 1 || howMany > room} onclick={add}>
              {t('demo.virtual.add')}
            </Button>
          </div>
        {:else}
          <Notice kind="warn">{t('demo.virtual.full', { max: status.virtualMax })}</Notice>
        {/if}
        <p>
          <Button variant="secondary" href={`/teacher/session/${status.session.id}`}>
            {t('demo.virtual.toLesson')}
          </Button>
        </p>
      {/if}
    </Card>

    <Card>
      <h2>{t('demo.reset.title')}</h2>
      <p class="muted small">{t('demo.reset.hint')}</p>
      <Button variant="danger" disabled={busy} onclick={reset}>{t('demo.reset.button')}</Button>
    </Card>
  {/if}
</main>

<style>
  .now {
    font-weight: 600;
    color: var(--c-dark);
  }
  .add {
    align-items: flex-end;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
  .count {
    width: 6em;
    height: var(--control);
    padding: 0 var(--space-3);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius);
    font: inherit;
  }
</style>
