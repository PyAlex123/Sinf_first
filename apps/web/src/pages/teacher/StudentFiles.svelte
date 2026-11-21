<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import FilesPanel from '../../lib/ui/FilesPanel.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';

  /** A child's "Мои работы" as their teacher sees it (H12): to look and to download, not to change. */
  let { params }: PageProps = $props();
  const studentId = $derived(params['id'] ?? '');
  let ready = $state(false);

  onMount(() => {
    void (async () => {
      try {
        await api.me();
        ready = true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.navigate('/teacher/login', { replace: true });
        }
      }
    })();
  });
</script>

<Header back="/teacher" />

<main class="page stack">
  <PageHeader title={t('files.title')} subtitle={t('files.teacherHint')} />
  {#if ready}
    {#key studentId}
      <FilesPanel access={{ kind: 'teacher', studentId }} readOnly />
    {/key}
  {/if}
</main>
