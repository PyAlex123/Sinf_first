<script lang="ts">
  import { t } from '../../lib/i18n/index.svelte.js';
  import type { PageProps } from '../../lib/router.svelte.js';
  import Header from '../../lib/ui/Header.svelte';

  let { params }: PageProps = $props();
</script>

<Header back="/" title="Session" />
<main class="page">
  <p>{t('common.loading')} {JSON.stringify(params)}</p>
</main>
