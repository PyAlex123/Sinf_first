<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '../lib/api.js';
  import { loadLessonBundle, type LessonBundle } from '../lib/content.js';
  import { t } from '../lib/i18n/index.svelte.js';
  import type { PageProps } from '../lib/router.svelte.js';
  import { SessionStore } from '../lib/stores/session.svelte.js';
  import Button from '../lib/ui/Button.svelte';
  import Notice from '../lib/ui/Notice.svelte';
  import QrCode from '../lib/ui/QrCode.svelte';
  import RestScreen from '../lib/ui/RestScreen.svelte';
  import StageTimer from '../lib/ui/StageTimer.svelte';
  import LessonPlayer from '../player/LessonPlayer.svelte';

  let { params }: PageProps = $props();
  const sessionId = $derived(params['id'] ?? '');

  let bundle = $state<LessonBundle | null>(null);
  let error = $state<string | null>(null);
  let endedBefore = $state(false);
  let joinCode = $state('');
  let classSize = $state(0);
  let store = $state<SessionStore | null>(null);
  let index = $state(0);

  const session = $derived(store?.state ?? null);
  const ended = $derived(endedBefore || session?.status === 'ended' || store?.status === 'ended');
  const participants = $derived(store?.participants ?? []);
  const online = $derived(participants.filter((p) => p.online).length);
  const joinUrl = $derived(
    typeof location === 'undefined' ? '' : `${location.origin}/join?code=${joinCode}`,
  );
  /** Before anybody joined the projector shows the code and the QR; then the lesson screen. */
  const showCode = $derived(participants.length === 0);

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
        joinCode = info.joinCode;
        bundle = await loadLessonBundle(info.lessonId);
        const roster = await api.joinLookup(info.joinCode).catch(() => null);
        classSize = roster?.students.length ?? 0;
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
  {:else if showCode}
    <main class="codescreen">
      <div class="col">
        <div class="label">{t('present.code')}</div>
        <div class="bigcode">{joinCode}</div>
        <div class="lesson">{bundle.lesson.title}</div>
      </div>
      <div class="col">
        <QrCode value={joinUrl} size={300} />
        <div class="scan">{t('present.scan')}</div>
        <div class="url">{joinUrl.replace(/^https?:\/\//, '')}</div>
      </div>
    </main>
  {:else}
    <LessonPlayer
      lesson={bundle.lesson}
      course={bundle.course}
      pics={bundle.pics}
      bind:index
      navigation="locked"
      header={false}
    />
    {#if session.stage.part === 'rest'}
      <RestScreen />
    {/if}
    <div class="hud">
      <StageTimer
        {session}
        stages={bundle.lesson.stages}
        now={() => store?.now() ?? Date.now()}
        compact
      />
      <span>
        {classSize > 0
          ? t('present.joined', { count: online, total: classSize })
          : t('present.participants', { count: online })}
      </span>
      <span class="code">{t('present.code')}: <b>{joinCode}</b></span>
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
  .codescreen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6vw;
    flex-wrap: wrap;
    padding: var(--space-5);
    text-align: center;
  }
  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
  }
  .label {
    font-size: var(--text-xl);
    color: var(--c-muted);
  }
  .bigcode {
    font-size: clamp(80px, 18vw, 220px);
    font-weight: 900;
    letter-spacing: 0.08em;
    color: var(--c-dark);
    line-height: 1;
  }
  .lesson {
    font-size: var(--text-xl);
    color: var(--c-accent);
    font-weight: 700;
  }
  .scan {
    font-size: var(--text-lg);
    color: var(--c-muted);
  }
  .url {
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--c-dark);
  }
  .hud .code b {
    color: var(--c-dark);
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
