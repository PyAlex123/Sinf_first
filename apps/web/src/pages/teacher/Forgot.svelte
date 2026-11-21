<script lang="ts">
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import type { PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Field from '../../lib/ui/Field.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';

  /** "Forgot the password" (PLAN.md 2.1; stage 5, A7): a letter with a link for an hour. */
  let { params: _params }: PageProps = $props();
  let email = $state('');
  let busy = $state(false);
  let sent = $state(false);
  let error = $state<string | null>(null);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    error = null;
    try {
      await api.forgotPassword(email.trim());
      sent = true;
    } catch (e) {
      error =
        e instanceof ApiError && e.code === 'edit_on_platform'
          ? t('reset.onPlatform')
          : t('common.error');
    } finally {
      busy = false;
    }
  }
</script>

<Header back="/teacher/login" />
<main class="page narrow">
  <Card>
    <h1>{t('reset.forgotTitle')}</h1>
    {#if sent}
      <Notice kind="ok"><span data-sent>{t('reset.sent')}</span></Notice>
      <p class="muted small">{t('reset.noLetter')}</p>
    {:else}
      <p class="muted">{t('reset.forgotHint')}</p>
      <form onsubmit={submit}>
        <Field label={t('login.email')}>
          <input type="email" bind:value={email} required autocomplete="username" />
        </Field>
        {#if error}<Notice kind="error">{error}</Notice>{/if}
        <Button type="submit" size="lg" block disabled={busy}>{t('reset.send')}</Button>
      </form>
    {/if}
  </Card>
</main>

<style>
  .page {
    padding-top: var(--space-6);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
</style>
