<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';
  import PracticeTaskEditor from '../../lib/ui/PracticeTaskEditor.svelte';
  import type { PracticeEditorHandle } from '../../lib/practice-catalog.js';

  /**
   * A practice task and its reference file (PLAN.md 3.7, stage 3 H13). The teacher picks the
   * program, assembles criteria from ready-made checks, gives points, and checks a correct file: it
   * must pass every automatic criterion. The same editor sits in the lesson constructor (W5), which
   * keeps the task in the lesson; here "Copy the task" gives the JSON an author's lesson file takes.
   */
  let { params: _params }: PageProps = $props();

  let editor: PracticeEditorHandle | null = null;
  let ready = $state(false);
  let copied = $state(false);

  async function copyTask(): Promise<void> {
    const json = editor?.taskJson();
    if (!json) return;
    await navigator.clipboard.writeText(json);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  onMount(() => {
    void (async () => {
      try {
        await api.me();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401)
          router.navigate('/teacher/login', { replace: true });
      }
    })();
    editor?.sample();
  });
</script>

<Header back="/teacher" title={t('practice.title')} />

<main class="page stack">
  <PageHeader title={t('practice.title')} subtitle={t('practice.subtitle')}>
    {#snippet actions()}
      <Button variant="secondary" onclick={() => editor?.sample()}>{t('practice.sample')}</Button>
      <Button variant="secondary" disabled={!ready} onclick={copyTask}>
        {copied ? t('practice.copied') : t('practice.copy')}
      </Button>
    {/snippet}
  </PageHeader>

  <PracticeTaskEditor
    onReady={(handle: PracticeEditorHandle) => (editor = handle)}
    onChange={(task) => (ready = task !== null)}
  />
</main>
