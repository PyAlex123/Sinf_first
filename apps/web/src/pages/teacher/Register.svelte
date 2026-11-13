<script lang="ts">
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
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
      router.navigate('/teacher', { replace: true });
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
      <label>
        <span>{t('register.name')}</span>
        <input type="text" bind:value={fullName} required autocomplete="name" minlength="2" />
      </label>
      <label>
        <span>{t('login.email')}</span>
        <input type="email" bind:value={email} required autocomplete="username" />
      </label>
      <label>
        <span>{t('login.password')}</span>
        <input
          type="password"
          bind:value={password}
          required
          autocomplete="new-password"
          minlength="8"
        />
        <small class="muted">{t('register.passwordHint')}</small>
      </label>
      {#if error}<Notice kind="error">{error}</Notice>{/if}
      <Button type="submit" size="lg" disabled={busy}>{t('register.submit')}</Button>
    </form>
    <p class="muted alt">
      {t('register.haveAccount')}
      <a href="/teacher/login">{t('login.submit')}</a>
    </p>
  </Card>
</main>

<style>
  .narrow {
    max-width: 420px;
    padding-top: var(--space-6);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-weight: 600;
    color: var(--c-dark);
  }
  input {
    min-height: 44px;
    padding: 0 var(--space-3);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    font-size: var(--text-md);
  }
  .alt {
    margin-top: var(--space-4);
  }
</style>
