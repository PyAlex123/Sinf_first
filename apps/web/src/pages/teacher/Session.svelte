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

  const session = $derived(store?.state ?? null);
  const participants = $derived(store?.participants ?? []);
  const count = $derived(bundle?.lesson.screens.length ?? 0);
  const screen = $derived(bundle?.lesson.screens[session?.screenIndex ?? 0]);
  const next = $derived(bundle?.lesson.screens[(session?.screenIndex ?? 0) + 1]);
  const stageTitle = $derived(
    bundle?.lesson.stages.find((s) => s.key === screen?.stage)?.title ?? '',
  );
  const ended = $derived(session?.status === 'ended' || store?.status === 'ended');

  // The teacher's preview follows the shared screen index.
  $effect(() => {
    if (session) index = session.screenIndex;
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
          <span class="pos">
            {t('session.screen', { index: session.screenIndex + 1, count })}
            {#if stageTitle}· {stageTitle}{/if}
          </span>
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
  .preview {
    flex: 1;
    min-height: 0;
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
