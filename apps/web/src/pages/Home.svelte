<script lang="ts">
  import { t } from '../lib/i18n/index.svelte.js';
  import type { PageProps } from '../lib/router.svelte.js';
  import Button from '../lib/ui/Button.svelte';
  import LangSwitch from '../lib/ui/LangSwitch.svelte';

  let { params: _params, query: _query }: PageProps = $props();
</script>

<main class="home">
  <div class="top"><LangSwitch /></div>
  <h1>{t('app.name')}</h1>
  <p class="sub">{t('home.subtitle')}</p>
  <div class="choice">
    <Button href="/join" size="xl">{t('home.student')}</Button>
    <Button href="/teacher" size="lg" variant="secondary">{t('home.teacher')}</Button>
  </div>
</main>

<style>
  .home {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    text-align: center;
  }
  .top {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
  }
  h1 {
    font-size: var(--text-2xl);
  }
  .sub {
    color: var(--c-muted);
    margin-bottom: var(--space-6);
  }
  .choice {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: min(100%, 420px);
  }
  .choice :global(.btn) {
    width: 100%;
  }
</style>
