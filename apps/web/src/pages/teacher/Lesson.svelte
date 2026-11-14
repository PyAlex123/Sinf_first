<script lang="ts">
  import { loadLessonBundle, type LessonBundle } from '../../lib/content.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import type { PageProps } from '../../lib/router.svelte.js';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import LessonPlayer from '../../player/LessonPlayer.svelte';

  let { params, query }: PageProps = $props();
  const lessonId = $derived(params['id'] ?? '');
  let bundle = $state<LessonBundle | null>(null);
  let error = $state<string | null>(null);
  // `?s=` only seeds the starting screen; later navigation is local state.
  // svelte-ignore state_referenced_locally
  let index = $state(Math.max(0, Number(query.get('s') ?? 1) - 1));

  $effect(() => {
    const id = lessonId;
    bundle = null;
    error = null;
    loadLessonBundle(id).then(
      (b) => (bundle = b),
      (e: unknown) => (error = e instanceof Error ? e.message : String(e)),
    );
  });
</script>

<div class="screen">
  <Header
    back="/teacher"
    title={bundle
      ? `${t('teacher.lesson.number', { num: bundle.lesson.num })}. ${bundle.lesson.title}`
      : ''}
  >
    {#if bundle}
      <a class="scenario" href={bundle.lesson.teacherScenario} target="_blank" rel="noopener">
        {t('teacher.lesson.scenario')} ↗
      </a>
    {/if}
  </Header>
  <div class="body">
    {#if error}
      <div class="page"><Notice kind="error">{error}</Notice></div>
    {:else if bundle}
      <LessonPlayer lesson={bundle.lesson} course={bundle.course} pics={bundle.pics} bind:index />
    {:else}
      <div class="page" aria-busy="true">{t('common.loading')}</div>
    {/if}
  </div>
</div>

<style>
  .screen {
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .body {
    flex: 1;
    min-height: 0;
  }
  .scenario {
    white-space: nowrap;
    font-weight: 600;
  }
</style>
