<script lang="ts">
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Field from '../../lib/ui/Field.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';

  /**
   * A new password by the link from a letter or from an administrator (PLAN.md 2.1; stage 5, A7).
   * The teacher is signed in with it; every other login of theirs ends.
   */
  let { params }: PageProps = $props();
  const token = $derived(params['token'] ?? '');
  let password = $state('');
  let again = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (password !== again) {
      error = t('reset.mismatch');
      return;
    }
    busy = true;
    error = null;
    try {
      await api.resetPassword(token, password);
      router.navigate('/teacher', { replace: true });
    } catch (e) {
      error =
        e instanceof ApiError && e.code === 'reset_gone'
          ? t('reset.gone')
          : e instanceof ApiError && e.status === 400
            ? t('register.weakPassword')
            : e instanceof ApiError && e.code === 'edit_on_platform'
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
    <h1>{t('reset.title')}</h1>
    <form onsubmit={submit}>
      <Field label={t('reset.password')} hint={t('register.passwordHint')}>
        <input
          type="password"
          bind:value={password}
          required
          minlength="8"
          autocomplete="new-password"
          data-field="new-password"
        />
      </Field>
      <Field label={t('reset.again')}>
        <input
          type="password"
          bind:value={again}
          required
          minlength="8"
          autocomplete="new-password"
          data-field="new-password-again"
        />
      </Field>
      {#if error}<Notice kind="error">{error}</Notice>{/if}
      <Button type="submit" size="lg" block disabled={busy}>{t('reset.submit')}</Button>
    </form>
    {#if error === t('reset.gone')}
      <p class="small"><a href="/teacher/forgot">{t('reset.askAgain')}</a></p>
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
  .small {
    font-size: var(--text-sm);
  }
</style>
