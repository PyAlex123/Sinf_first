<script lang="ts">
  import { t } from './lib/i18n/index.svelte.js';
  import { router } from './lib/router.svelte.js';
  import Button from './lib/ui/Button.svelte';

  const Page = $derived(router.page);
  const match = $derived(router.current);
</script>

{#if router.notFound}
  <main class="page center">
    <h1>{t('common.notFound')}</h1>
    <Button href="/">{t('common.home')}</Button>
  </main>
{:else if Page && match}
  <Page params={match.params} query={match.query} />
{:else}
  <main class="page center" aria-busy="true">
    <p>{t('common.loading')}</p>
  </main>
{/if}

<style>
  .center {
    text-align: center;
    padding-top: var(--space-6);
  }
</style>
