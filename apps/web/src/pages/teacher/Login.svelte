<script lang="ts">
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
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
      router.navigate('/teacher', { replace: true });
    } catch (e) {
      error = e instanceof ApiError && e.status === 401 ? t('login.failed') : t('common.error');
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
      <label>
        <span>{t('login.email')}</span>
        <input type="email" bind:value={email} required autocomplete="username" />
      </label>
      <label>
        <span>{t('login.password')}</span>
        <input type="password" bind:value={password} required autocomplete="current-password" />
      </label>
      {#if error}<Notice kind="error">{error}</Notice>{/if}
      <Button type="submit" size="lg" disabled={busy}>{t('login.submit')}</Button>
    </form>
    <p class="muted alt">
      {t('login.noAccount')}
      <a href="/teacher/register">{t('register.submit')}</a>
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
