<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '../lib/api.js';
  import { loadLessonBundle, type LessonBundle } from '../lib/content.js';
  import { t } from '../lib/i18n/index.svelte.js';
  import type { PageProps } from '../lib/router.svelte.js';
  import { SessionStore } from '../lib/stores/session.svelte.js';
  import Button from '../lib/ui/Button.svelte';
  import Notice from '../lib/ui/Notice.svelte';
  import LessonPlayer from '../player/LessonPlayer.svelte';

  let { params }: PageProps = $props();
  const sessionId = $derived(params['id'] ?? '');

  let bundle = $state<LessonBundle | null>(null);
  let error = $state<string | null>(null);
  let endedBefore = $state(false);
  let store = $state<SessionStore | null>(null);
  let index = $state(0);

  const session = $derived(store?.state ?? null);
  const ended = $derived(endedBefore || session?.status === 'ended' || store?.status === 'ended');
  const online = $derived((store?.participants ?? []).filter((p) => p.online).length);

  $effect(() => {
    if (session) index = session.screenIndex;
  });

  function toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
  }

  onMount(() => {
    const id = sessionId;
    const s = new SessionStore(id, 'projector');
    store = s;
    void (async () => {
      try {
        const info = await api.joinSession(id);
        if (info.status === 'ended') {
          endedBefore = true;
          return;
        }
        bundle = await loadLessonBundle(info.lessonId);
        s.connect();
      } catch (e) {
        error =
          e instanceof ApiError && e.status === 404 ? t('common.notFound') : t('common.error');
      }
    })();
    return () => s.disconnect();
  });
</script>

<div class="present">
  {#if error}
    <main class="page"><Notice kind="error">{error}</Notice></main>
  {:else if ended}
    <main class="center"><h1>{t('present.ended')}</h1></main>
  {:else if !bundle || !session}
    <main class="center" aria-busy="true">{t('common.loading')}</main>
  {:else}
    <LessonPlayer
      lesson={bundle.lesson}
      course={bundle.course}
      pics={bundle.pics}
      bind:index
      navigation="locked"
      header={false}
    />
    <div class="hud">
      <span>{t('present.participants', { count: online })}</span>
      <Button variant="secondary" size="md" onclick={toggleFullscreen}>⛶</Button>
    </div>
  {/if}
</div>

<style>
  .present {
    height: 100vh;
  }
  .center {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .hud {
    position: fixed;
    top: var(--space-2);
    right: var(--space-2);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    background: rgba(255, 255, 255, 0.85);
    border-radius: 999px;
    padding: 4px 6px 4px 14px;
    color: var(--c-dark);
    font-weight: 600;
    z-index: 40;
  }
</style>
