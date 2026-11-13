<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '../lib/api.js';
  import { loadLessonBundle, type LessonBundle } from '../lib/content.js';
  import { t } from '../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../lib/router.svelte.js';
  import { readParticipantToken, SessionStore } from '../lib/stores/session.svelte.js';
  import Button from '../lib/ui/Button.svelte';
  import Notice from '../lib/ui/Notice.svelte';
  import RestScreen from '../lib/ui/RestScreen.svelte';
  import StageTimer from '../lib/ui/StageTimer.svelte';
  import LessonPlayer from '../player/LessonPlayer.svelte';

  let { params }: PageProps = $props();
  const sessionId = $derived(params['id'] ?? '');

  let bundle = $state<LessonBundle | null>(null);
  let error = $state<string | null>(null);
  let endedBefore = $state(false);
  let started = $state(false);
  let store = $state<SessionStore | null>(null);
  let index = $state(0);

  const session = $derived(store?.state ?? null);
  const me = $derived(store?.me);
  const lock = $derived(store?.myLock ?? null);
  const ended = $derived(endedBefore || session?.status === 'ended' || store?.status === 'ended');
  const kicked = $derived(store?.kicked === true);
  const free = $derived(session?.mode === 'free');
  /** During the rest part of practice the screen is covered (STAGE1 S1.8). */
  const resting = $derived(session?.stage.part === 'rest');

  // In presentation mode the teacher drives the screen; in free mode the student keeps their own place.
  $effect(() => {
    if (session && session.mode === 'presentation') index = session.screenIndex;
  });

  function start(): void {
    started = true;
    const root = document.documentElement;
    if (root.requestFullscreen) {
      root.requestFullscreen().catch(() => undefined);
    }
    store?.connect();
  }

  function report(): void {
    store?.visibility(document.hidden, !!document.fullscreenElement);
  }

  onMount(() => {
    const id = sessionId;
    const s = new SessionStore(id, 'student');
    store = s;
    void (async () => {
      try {
        const info = await api.joinSession(id);
        if (info.status === 'ended') {
          endedBefore = true;
          return;
        }
        if (!readParticipantToken(id)) {
          // No token in this tab: the student has not entered the personal code yet (S1.7).
          router.navigate(`/join?code=${encodeURIComponent(info.joinCode ?? '')}`, {
            replace: true,
          });
          return;
        }
        bundle = await loadLessonBundle(info.lessonId);
      } catch (e) {
        error =
          e instanceof ApiError && e.status === 404 ? t('common.notFound') : t('common.error');
      }
    })();
    const onVisibility = (): void => {
      report();
    };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onVisibility);
      s.disconnect();
    };
  });
</script>

<div class="student">
  {#if error}
    <main class="page"><Notice kind="error">{error}</Notice></main>
  {:else if kicked}
    <main class="center">
      <h1>{t('student.kicked')}</h1>
      <Button href="/join" size="lg">{t('student.loginAgain')}</Button>
    </main>
  {:else if ended}
    <main class="center">
      <h1>{t('student.ended')}</h1>
      <Button href="/join" size="lg">{t('common.home')}</Button>
    </main>
  {:else if !bundle}
    <main class="center" aria-busy="true">{t('common.loading')}</main>
  {:else if !started}
    <main class="center">
      <h1>{bundle.lesson.title}</h1>
      <p class="muted">{t('student.startHint')}</p>
      <Button size="xl" onclick={start}>{t('student.start')}</Button>
    </main>
  {:else}
    <div class="play">
      <LessonPlayer
        lesson={bundle.lesson}
        course={bundle.course}
        pics={bundle.pics}
        bind:index
        navigation={free ? 'free' : 'locked'}
        doneScreens={me?.doneScreens ?? []}
        stars={me?.stars ?? 0}
        onNavigate={(i: number) => store?.setScreen(i)}
        onScreenDone={(i: number, stars: number) => store?.screenDone(i, stars)}
      />
      {#if resting}
        <RestScreen />
      {/if}
      <div class="hud">
        {#if session && bundle}
          <span class="num">
            <StageTimer
              {session}
              stages={bundle.lesson.stages}
              now={() => store?.now() ?? Date.now()}
              compact
            />
          </span>
        {/if}
        {#if me}
          <span class="num">
            {me.name
              ? t('student.name', { name: me.name })
              : t('student.number', { number: me.number })}
          </span>
        {/if}
        {#if store?.status !== 'open'}<span class="conn">{t('student.reconnecting')}</span>{/if}
        <button
          type="button"
          class="hand"
          class:up={me?.hand}
          onclick={() => store?.hand(!me?.hand)}
        >
          ✋ {me?.hand ? t('student.handDown') : t('student.hand')}
        </button>
      </div>
      {#if lock}
        <div class="lock" role="alert">
          <div class="lock-text">{lock.text || t('student.lockDefault')}</div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .student {
    height: 100vh;
  }
  .center {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    padding: var(--space-4);
    text-align: center;
  }
  .muted {
    color: var(--c-muted);
  }
  .play {
    position: relative;
    height: 100%;
  }
  .hud {
    position: fixed;
    right: var(--space-3);
    bottom: 92px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2);
    z-index: 40;
  }
  .num,
  .conn {
    background: rgba(19, 35, 58, 0.8);
    color: #fff;
    border-radius: 999px;
    padding: 4px 12px;
    font-size: var(--text-sm);
  }
  .conn {
    background: var(--c-danger);
  }
  .hand {
    min-height: var(--tap);
    padding: 0 var(--space-4);
    border-radius: 999px;
    border: 3px solid #fff;
    background: var(--c-teal);
    color: #fff;
    font-weight: 700;
    font-size: var(--text-md);
    box-shadow: var(--shadow);
  }
  .hand.up {
    background: var(--c-accent);
  }
  .lock {
    position: fixed;
    inset: 0;
    z-index: 70;
    background: var(--c-dark);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
    text-align: center;
  }
  .lock-text {
    font-size: clamp(28px, 6vw, 64px);
    font-weight: 800;
    line-height: 1.2;
  }
  @media (max-width: 480px) {
    .hud {
      bottom: 84px;
      right: var(--space-2);
    }
    .hand {
      min-height: 44px;
      padding: 0 var(--space-3);
      font-size: var(--text-sm);
    }
  }
</style>
