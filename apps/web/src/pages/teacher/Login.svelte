<script lang="ts">
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { nextPath, withNext } from '../../lib/next.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Field from '../../lib/ui/Field.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';

  let { params: _params }: PageProps = $props();
  let email = $state('demo@sinf.local');
  let password = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    error = null;
    try {
      await api.login({ email, password });
      router.navigate(nextPath() ?? '/teacher', { replace: true });
    } catch (e) {
      error =
        e instanceof ApiError && e.code === 'teacher_local_only'
          ? t('login.localOnly')
          : e instanceof ApiError && e.status === 401
            ? t('login.failed')
            : t('common.error');
    } finally {
      busy = false;
    }
  }
</script>

<Header back="/" />
<main class="page narrow">
  <Card>
    <h1>{t('login.title')}</h1>
    <form onsubmit={submit}>
      <Field label={t('login.email')}>
        <input type="email" bind:value={email} required autocomplete="username" />
      </Field>
      <Field label={t('login.password')}>
        <input type="password" bind:value={password} required autocomplete="current-password" />
      </Field>
      {#if error}<Notice kind="error">{error}</Notice>{/if}
      <Button type="submit" size="lg" block disabled={busy}>{t('login.submit')}</Button>
    </form>
    <p class="muted small alt"><a href="/teacher/forgot">{t('reset.forgotLink')}</a></p>
    <p class="muted small alt">
      {t('login.noAccount')}
      <a href={withNext('/teacher/register')}>{t('register.submit')}</a>
    </p>
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
  }
  .alt {
    margin-top: var(--space-4);
    text-align: center;
  }
</style>
