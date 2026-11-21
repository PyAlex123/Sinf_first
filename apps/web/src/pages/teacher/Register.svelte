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
  let fullName = $state('');
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    error = null;
    try {
      await api.register({ fullName, email, password });
      router.navigate(nextPath() ?? '/teacher', { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) error = t('register.emailTaken');
      else if (e instanceof ApiError && e.status === 400) error = t('register.weakPassword');
      else error = t('common.error');
    } finally {
      busy = false;
    }
  }
</script>

<Header back="/" />
<main class="page narrow">
  <Card>
    <h1>{t('register.title')}</h1>
    <p class="muted">{t('register.hint')}</p>
    <form onsubmit={submit}>
      <Field label={t('register.name')}>
        <input type="text" bind:value={fullName} required autocomplete="name" minlength="2" />
      </Field>
      <Field label={t('login.email')}>
        <input type="email" bind:value={email} required autocomplete="username" />
      </Field>
      <Field label={t('login.password')} hint={t('register.passwordHint')}>
        <input
          type="password"
          bind:value={password}
          required
          autocomplete="new-password"
          minlength="8"
        />
      </Field>
      {#if error}<Notice kind="error">{error}</Notice>{/if}
      <Button type="submit" size="lg" block disabled={busy}>{t('register.submit')}</Button>
    </form>
    <p class="muted small alt">
      {t('register.haveAccount')}
      <a href={withNext('/teacher/login')}>{t('login.submit')}</a>
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
    margin-top: var(--space-4);
  }
  .alt {
    margin-top: var(--space-4);
    text-align: center;
  }
</style>
