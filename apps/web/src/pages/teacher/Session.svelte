<script lang="ts">
  import type { Participant, SessionSummary } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { loadLessonBundle, type LessonBundle } from '../../lib/content.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import { SessionStore } from '../../lib/stores/session.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import StageTimer from '../../lib/ui/StageTimer.svelte';
  import LessonPlayer from '../../player/LessonPlayer.svelte';

  let { params }: PageProps = $props();
  const sessionId = $derived(params['id'] ?? '');

  let summary = $state<SessionSummary | null>(null);
  let bundle = $state<LessonBundle | null>(null);
  let error = $state<string | null>(null);
  let store = $state<SessionStore | null>(null);
  let selected = $state<string[]>([]);
  let lockText = $state('');
  let index = $state(0);
  let nextIndex = $state(1);
  let scenarioOpen = $state(false);

  const session = $derived(store?.state ?? null);
  const participants = $derived(store?.participants ?? []);
  const count = $derived(bundle?.lesson.screens.length ?? 0);
  const next = $derived(bundle?.lesson.screens[(session?.screenIndex ?? 0) + 1]);
  const stages = $derived(bundle?.lesson.stages ?? []);
  const stageNumber = $derived((session?.stage.index ?? 0) + 1);
  /** The teacher scenario opens at the heading of the current stage (anchors added by the import, S1.9). */
  const scenarioUrl = $derived(
    bundle ? `${bundle.lesson.teacherScenario}#stage-${stageNumber}` : '',
  );
  const paused = $derived(
    session?.stage.pausedAt !== null && session?.stage.pausedAt !== undefined,
  );
  const ended = $derived(session?.status === 'ended' || store?.status === 'ended');

  // The teacher's preview follows the shared screen index.
  $effect(() => {
    if (!session) return;
    index = session.screenIndex;
    nextIndex = Math.min(count - 1, session.screenIndex + 1);
  });

  function go(delta: number): void {
    if (!session) return;
    store?.setScreen(Math.max(0, Math.min(count - 1, session.screenIndex + delta)));
  }

  function toggleSelect(id: string): void {
    selected = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
  }

  function lock(targets: 'all' | string[]): void {
    store?.lock(targets, lockText.trim() || t('session.lock.text'));
  }

  function isLocked(p: Participant): boolean {
    return !!(session?.lock.byParticipant[p.id] ?? session?.lock.all);
  }

  async function endSession(): Promise<void> {
    if (!confirm(t('teacher.session.confirmEnd'))) return;
    store?.end();
    try {
      await api.endSession(sessionId);
    } catch {
      // the socket command already ended it
    }
    router.navigate('/teacher');
  }

  function onKey(event: KeyboardEvent): void {
    if ((event.target as HTMLElement | null)?.tagName === 'INPUT') return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') go(1);
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') go(-1);
  }

  onMount(() => {
    const id = sessionId;
    const s = new SessionStore(id, 'teacher');
    store = s;
    void (async () => {
      try {
        const res = await api.session(id);
        summary = res.session;
        bundle = await loadLessonBundle(res.session.lessonId);
        if (res.session.status === 'ended') return;
        s.connect();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.navigate('/teacher/login', { replace: true });
          return;
        }
        error = e instanceof Error ? e.message : t('common.error');
      }
    })();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      s.disconnect();
    };
  });
</script>

<div class="screen">
  <Header back="/teacher" title={summary?.lessonTitle ?? ''} lang={false}>
    {#if summary && !ended}
      <span class="joincode">{t('present.code')}: <b>{summary.joinCode}</b></span>
      <a class="proj" href={`/present/${summary.id}`} target="_blank" rel="noopener">
        {t('session.projector')} ↗
      </a>
      <Button variant="danger" onclick={endSession}>{t('teacher.session.end')}</Button>
    {/if}
  </Header>

  {#if error}
    <main class="page"><Notice kind="error">{error}</Notice></main>
  {:else if ended || summary?.status === 'ended'}
    <main class="page">
      <Notice>{t('teacher.session.ended')}</Notice>
      <p><Button href="/teacher">{t('common.back')}</Button></p>
    </main>
  {:else if !bundle || !session}
    <main class="page" aria-busy="true">{t('common.loading')}</main>
  {:else}
    <div class="panel">
      <section class="left">
        <div class="toolbar">
          <Button variant="secondary" disabled={session.screenIndex === 0} onclick={() => go(-1)}
            >←</Button
          >
          <span class="pos">{t('session.screen', { index: session.screenIndex + 1, count })}</span>
          <Button
            variant="secondary"
            disabled={session.screenIndex >= count - 1}
            onclick={() => go(1)}>→</Button
          >
          <span class="spacer"></span>
          <div class="modes" role="group" aria-label={t('session.mode')}>
            <button
              type="button"
              class:active={session.mode === 'presentation'}
              onclick={() => store?.setMode('presentation')}
              >{t('session.mode.presentation')}</button
            >
            <button
              type="button"
              class:active={session.mode === 'free'}
              onclick={() => store?.setMode('free')}>{t('session.mode.free')}</button
            >
          </div>
        </div>
        <div class="stagebar">
          <StageTimer {session} {stages} now={() => store?.now() ?? Date.now()} />
          <span class="spacer"></span>
          <Button variant="secondary" size="md" onclick={() => store?.backStage()}>
            ⏮ {t('stage.back')}
          </Button>
          {#if paused}
            <Button variant="secondary" size="md" onclick={() => store?.resumeStage()}>
              ▶ {t('stage.resume')}
            </Button>
          {:else}
            <Button variant="secondary" size="md" onclick={() => store?.pauseStage()}>
              ⏸ {t('stage.pause')}
            </Button>
          {/if}
          <Button variant="secondary" size="md" onclick={() => store?.extendStage(5)}>
            {t('stage.extend')}
          </Button>
          <Button variant="secondary" size="md" onclick={() => store?.skipStage()}>
            {t('stage.skip')} ⏭
          </Button>
          <button
            type="button"
            class="scenariobtn"
            class:on={scenarioOpen}
            onclick={() => (scenarioOpen = !scenarioOpen)}
          >
            {scenarioOpen ? t('session.scenario.hide') : t('session.scenario.show')}
          </button>
          <button
            type="button"
            class="speed"
            class:on={session.demoSpeed > 1}
            title={t('stage.demoSpeed')}
            onclick={() => store?.setDemoSpeed(session.demoSpeed > 1 ? 1 : 10)}
          >
            {session.demoSpeed > 1 ? t('stage.demoSpeed.on') : t('stage.demoSpeed.off')}
          </button>
        </div>
        <div class="previews">
          <div class="preview">
            <LessonPlayer
              lesson={bundle.lesson}
              course={bundle.course}
              pics={bundle.pics}
              bind:index
              navigation="locked"
              header={false}
            />
          </div>
          {#if next}
            <button
              type="button"
              class="nextpreview"
              title={t('session.nextPreview')}
              onclick={() => go(1)}
            >
              <span class="caption">
                {t('session.nextPreview')} · {t(`screen.${next.kind}`)}
              </span>
              <div class="shrink">
                <LessonPlayer
                  lesson={bundle.lesson}
                  course={bundle.course}
                  pics={bundle.pics}
                  bind:index={nextIndex}
                  navigation="locked"
                  header={false}
                />
              </div>
            </button>
          {/if}
        </div>
        {#if scenarioOpen}
          <div class="scenario">
            <div class="scenariobar">
              <strong>{t('session.scenario')}</strong>
              <span class="muted">{stages[session.stage.index]?.title ?? ''}</span>
              <span class="spacer"></span>
              <a href={scenarioUrl} target="_blank" rel="noopener">{t('session.scenario.open')} ↗</a
              >
              <Button variant="ghost" size="md" onclick={() => (scenarioOpen = false)}>✕</Button>
            </div>
            {#key scenarioUrl}
              <iframe src={scenarioUrl} title={t('session.scenario')}></iframe>
            {/key}
          </div>
        {/if}
        <div class="hint">
          {t('session.keys')}
          {#if next}
            · {t('session.nextScreen')}: {t(`screen.${next.kind}`)}
          {/if}
        </div>
      </section>

      <aside class="right">
        <div class="lockbox">
          <input
            type="text"
            bind:value={lockText}
            placeholder={t('session.lock.text')}
            aria-label={t('session.lockText')}
          />
          <div class="lockbtns">
            <Button variant="danger" onclick={() => lock('all')}>{t('session.lock.all')}</Button>
            <Button
              variant="secondary"
              disabled={selected.length === 0}
              onclick={() => lock(selected)}
            >
              {t('session.lock.selected')}
            </Button>
            <Button variant="secondary" onclick={() => store?.unlock('all')}
              >{t('session.unlock.all')}</Button
            >
          </div>
          <p class="soft">{t('session.lock.soft')}</p>
        </div>

        <h2>
          {t('session.participants')}
          <span class="muted">({participants.filter((p) => p.online).length})</span>
        </h2>
        {#if participants.length === 0}
          <p class="muted">{t('session.participants.none')}</p>
          <p class="muted">{t('session.joinHint')}</p>
        {:else}
          <div class="selbar">
            <button
              type="button"
              class="link"
              onclick={() => (selected = participants.map((p) => p.id))}
            >
              {t('session.selectAll')}
            </button>
            <button type="button" class="link" onclick={() => (selected = [])}
              >{t('session.clearSelection')}</button
            >
            {#if selected.length}<span class="muted"
                >{t('session.selected', { count: selected.length })}</span
              >{/if}
          </div>
          <div class="tiles">
            {#each participants as p (p.id)}
              <button
                type="button"
                class="tile"
                class:offline={!p.online}
                class:selected={selected.includes(p.id)}
                class:locked={isLocked(p)}
                aria-pressed={selected.includes(p.id)}
                onclick={() => toggleSelect(p.id)}
              >
                <div class="tname">
                  <span class="dot" class:on={p.online}></span>
                  {p.name ?? t('session.participant', { number: p.number })}
                </div>
                <div class="tmeta">
                  <span>{t('session.screenShort', { index: p.screenIndex + 1 })}</span>
                  <span class="stars">{t('session.stars', { count: p.stars })}</span>
                </div>
                <div class="flags">
                  {#if p.hand}<span class="flag hand">✋ {t('session.hand')}</span>{/if}
                  {#if p.hidden}<span class="flag away">{t('session.hidden')}</span>{/if}
                  {#if isLocked(p)}<span class="flag lock">🔒</span>{/if}
                  {#if !p.online}<span class="flag">{t('session.offline')}</span>{/if}
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </aside>
    </div>
  {/if}
</div>

<style>
  .screen {
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .proj {
    font-weight: 600;
    white-space: nowrap;
  }
  .joincode {
    color: var(--c-muted);
    white-space: nowrap;
  }
  .joincode b {
    color: var(--c-dark);
    font-size: var(--text-lg);
    letter-spacing: 0.06em;
  }
  .panel {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
  }
  .left {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    border-right: 1px solid var(--c-line);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--c-surface);
    border-bottom: 1px solid var(--c-line);
  }
  .pos {
    font-weight: 600;
    color: var(--c-dark);
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
  .modes {
    display: inline-flex;
    border: 1px solid var(--c-line);
    border-radius: 999px;
    overflow: hidden;
  }
  .modes button {
    border: 0;
    background: transparent;
    padding: var(--space-2) var(--space-3);
    min-height: 36px;
    color: var(--c-muted);
  }
  .modes .active {
    background: var(--c-teal);
    color: #fff;
  }
  .stagebar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--c-bg-2);
    border-bottom: 1px solid var(--c-line);
    flex-wrap: wrap;
  }
  .speed {
    min-height: 36px;
    padding: 0 var(--space-3);
    border: 1px solid var(--c-line);
    border-radius: 999px;
    background: var(--c-surface);
    color: var(--c-muted);
    font-weight: 700;
  }
  .speed.on {
    background: var(--c-teal);
    color: #fff;
    border-color: var(--c-teal);
  }
  .previews {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
  }
  .preview {
    min-width: 0;
    min-height: 0;
  }
  .nextpreview {
    position: relative;
    border: 0;
    border-left: 1px solid var(--c-line);
    background: var(--c-bg-2);
    padding: 0;
    overflow: hidden;
    text-align: left;
  }
  .nextpreview .caption {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2;
    padding: 4px var(--space-2);
    font-size: var(--text-sm);
    color: #fff;
    background: rgba(19, 35, 58, 0.75);
  }
  /* The next screen is drawn small: the player lays out for a full stage, so it is scaled down. */
  .shrink {
    width: 200%;
    height: 200%;
    transform: scale(0.5);
    transform-origin: top left;
    pointer-events: none;
  }
  .scenario {
    position: absolute;
    inset: auto 0 0 0;
    height: 45%;
    display: flex;
    flex-direction: column;
    background: var(--c-surface);
    border-top: 2px solid var(--c-line);
    box-shadow: 0 -6px 18px rgba(19, 35, 58, 0.12);
    z-index: 5;
  }
  .scenariobar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--c-line);
  }
  .scenario iframe {
    flex: 1;
    border: 0;
    width: 100%;
  }
  .scenariobtn {
    min-height: 36px;
    padding: 0 var(--space-3);
    border: 1px solid var(--c-line);
    border-radius: 999px;
    background: var(--c-surface);
    color: var(--c-muted);
    font-weight: 600;
  }
  .scenariobtn.on {
    background: var(--c-dark);
    color: #fff;
    border-color: var(--c-dark);
  }
  @media (max-width: 1200px) {
    .previews {
      grid-template-columns: minmax(0, 1fr);
    }
    .nextpreview {
      display: none;
    }
  }
  .hint {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    color: var(--c-muted);
    background: var(--c-surface);
    border-top: 1px solid var(--c-line);
  }
  .right {
    overflow: auto;
    padding: var(--space-3);
    background: var(--c-bg-2);
  }
  .lockbox {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .lockbox input {
    min-height: 40px;
    padding: 0 var(--space-3);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
  }
  .lockbtns {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .soft {
    font-size: var(--text-sm);
    color: var(--c-muted);
    margin: 0;
  }
  .muted {
    color: var(--c-muted);
    font-weight: 400;
  }
  .selbar {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    margin-bottom: var(--space-2);
    font-size: var(--text-sm);
  }
  .link {
    border: 0;
    background: none;
    color: var(--c-accent);
    padding: 0;
    text-decoration: underline;
  }
  .tiles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .tile {
    text-align: left;
    background: var(--c-surface);
    border: 2px solid var(--c-line);
    border-radius: var(--radius);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .tile.selected {
    border-color: var(--c-accent);
  }
  .tile.locked {
    background: #fdecea;
  }
  .tile.offline {
    opacity: 0.55;
  }
  .tname {
    font-weight: 700;
    color: var(--c-dark);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--c-line);
  }
  .dot.on {
    background: var(--c-ok);
  }
  .tmeta {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-sm);
    color: var(--c-muted);
  }
  .stars {
    color: var(--c-star);
    font-weight: 700;
  }
  .flags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    font-size: 12px;
  }
  .flag {
    background: var(--c-bg-2);
    border-radius: 999px;
    padding: 1px 8px;
  }
  .flag.hand {
    background: #fff4e5;
    color: var(--c-accent);
    font-weight: 700;
  }
  .flag.away {
    background: #fdecea;
    color: var(--c-danger);
  }
  @media (max-width: 1100px) {
    .panel {
      grid-template-columns: minmax(0, 1fr) 300px;
    }
  }
</style>
