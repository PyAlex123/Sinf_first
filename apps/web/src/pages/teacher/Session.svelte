<script lang="ts">
  import {
    comparePcNames,
    DEMO_CLASS_ID,
    type Participant,
    type SessionSummary,
  } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { loadLessonBundle, type LessonBundle } from '../../lib/content.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import { hostSend, platform } from '../../lib/platform.js';
  import { SessionStore } from '../../lib/stores/session.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import EmptyState from '../../lib/ui/EmptyState.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import StageTimer from '../../lib/ui/StageTimer.svelte';
  import Toolbar from '../../lib/ui/Toolbar.svelte';
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
  /**
   * Who sits at a classroom app, where "Attention!" really stops keyboard and mouse (stage 3, H4),
   * and who is in a browser, where it only covers the page.
   */
  const inBrowser = $derived(participants.filter((p) => !p.pc && !p.virtual).length);
  const inClassroom = $derived(participants.filter((p) => !!p.pc).length);

  /**
   * Tiles in register order, or the way the class sits (H8): by classroom computer, the room's own
   * numbering, children in a browser last. The choice is the teacher's habit, kept on this computer.
   */
  const ORDER_KEY = 'sinf.tiles.order';
  let order = $state<'list' | 'seats'>(readOrder());
  function readOrder(): 'list' | 'seats' {
    try {
      return localStorage.getItem(ORDER_KEY) === 'seats' ? 'seats' : 'list';
    } catch {
      return 'list';
    }
  }
  function setOrder(value: 'list' | 'seats'): void {
    order = value;
    try {
      localStorage.setItem(ORDER_KEY, value);
    } catch {
      // private mode: the order lasts for this page only
    }
  }
  const tiles = $derived(
    order === 'seats'
      ? [...participants].sort((a, b) =>
          a.pc && b.pc ? comparePcNames(a.pc, b.pc) : a.pc ? -1 : b.pc ? 1 : a.number - b.number,
        )
      : participants,
  );

  /**
   * Screen broadcast (H14). The teacher's own screen can only be filmed by the teacher's app; the
   * page asks the app to film while "Мой экран" is on — and to stop when it is off.
   */
  const demoNow = $derived(session?.demo ?? null);
  const canShareMine = platform.isDesktop && platform.role === 'teacher';
  $effect(() => {
    if (!canShareMine || demoNow?.source !== 'teacher') return;
    hostSend({ type: 'share', on: true, sessionId });
    return () => hostSend({ type: 'share', on: false, sessionId });
  });

  /** One child's screen, large (H8): the live thumbnail, with the lock and a screenshot at hand. */
  let zoomed = $state<string | null>(null);
  let zoomDialog = $state<HTMLDialogElement | null>(null);
  const zoomedP = $derived(zoomed ? (session?.participants[zoomed] ?? null) : null);
  $effect(() => {
    if (!zoomDialog) return;
    if (zoomed && !zoomDialog.open) zoomDialog.showModal();
    if (!zoomed && zoomDialog.open) zoomDialog.close();
  });

  /** "Logged in on another computer" (§4.1 item 7, H8): the child's name and both computers. */
  function moveText(m: { participantId: string; from: string | null; to: string | null }): string {
    const name = session?.participants[m.participantId]?.name ?? '';
    return t('session.moved', {
      name,
      from: m.from ?? t('session.moved.browser'),
      to: m.to ?? t('session.moved.browser'),
    });
  }
  const count = $derived(bundle?.lesson.screens.length ?? 0);
  const next = $derived(bundle?.lesson.screens[(session?.screenIndex ?? 0) + 1]);
  const stages = $derived(bundle?.lesson.stages ?? []);
  const stageNumber = $derived((session?.stage.index ?? 0) + 1);
  /** The teacher scenario opens at the heading of the current stage (anchors added by the import, S1.9). */
  const scenarioUrl = $derived(
    bundle ? `${bundle.lesson.teacherScenario}#stage-${stageNumber}` : '',
  );
  /**
   * The Paint practice of a club lesson (S1.11): which screens are its steps, where each child is,
   * and from which stage the teacher may start giving stars for the drawing.
   */
  const stepScreens = $derived(
    bundle ? bundle.lesson.screens.flatMap((screen, i) => (screen.kind === 'step' ? [i] : [])) : [],
  );
  const practiceStage = $derived(stages.findIndex((stage) => stage.key === 'practice'));
  const showStars = $derived(
    stepScreens.length > 0 && practiceStage >= 0 && (session?.stage.index ?? 0) >= practiceStage,
  );
  /** 1-based number of the step this child is looking at; 0 when it is not a step screen. */
  const stepOf = (p: Participant): number => stepScreens.indexOf(p.screenIndex) + 1;

  /** The live quiz (S1.12): it starts with its stage, and these buttons move it along. */
  const quiz = $derived(session?.quiz ?? null);
  const hasQuiz = $derived(!!bundle?.quiz);

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

  /** While everybody is locked a single student cannot be released: the lock has no exceptions. */
  const lockedAll = $derived(!!session?.lock.all);

  function toggleLockOne(p: Participant): void {
    if (!isLocked(p)) {
      store?.lock([p.id], lockText.trim() || t('session.lock.text'));
    } else if (!lockedAll) {
      store?.unlock([p.id]);
    }
  }

  async function endSession(): Promise<void> {
    if (!confirm(t('teacher.session.confirmEnd'))) return;
    store?.end();
    try {
      await api.endSession(sessionId);
    } catch {
      // the socket command already ended it
    }
    // Right after the lesson the teacher sees how it went (S1.13).
    router.navigate(`/teacher/session/${sessionId}/results`);
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
      {#if summary.classId === DEMO_CLASS_ID}
        <a class="proj" href="/teacher/demo">{t('session.demo')}</a>
      {/if}
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
      <p class="row">
        <Button href={`/teacher/session/${sessionId}/results`}>
          {t('teacher.session.results')}
        </Button>
        <Button variant="ghost" href="/teacher">{t('common.back')}</Button>
      </p>
    </main>
  {:else if !bundle || !session}
    <main class="page" aria-busy="true">{t('common.loading')}</main>
  {:else}
    <div class="panel">
      <section class="left">
        <!-- One band of controls: the time left, then the stage, the screen, and the mode. -->
        <Toolbar>
          {#snippet lead()}
            <StageTimer {session} {stages} now={() => store?.now() ?? Date.now()} />
          {/snippet}

          <div class="group" role="group" aria-label={t('stage.timer')}>
            <Button variant="secondary" size="sm" onclick={() => store?.backStage()}>
              <Icon name="back" size={16} />
              {t('stage.back')}
            </Button>
            {#if paused}
              <Button variant="secondary" size="sm" onclick={() => store?.resumeStage()}>
                <Icon name="play" size={16} />
                {t('stage.resume')}
              </Button>
            {:else}
              <Button variant="secondary" size="sm" onclick={() => store?.pauseStage()}>
                <Icon name="pause" size={16} />
                {t('stage.pause')}
              </Button>
            {/if}
            <Button variant="secondary" size="sm" onclick={() => store?.extendStage(5)}>
              {t('stage.extend')}
            </Button>
            <Button variant="secondary" size="sm" onclick={() => store?.skipStage()}>
              {t('stage.skip')}
              <Icon name="skip" size={16} />
            </Button>
          </div>

          {#if quiz}
            <div class="group" role="group" aria-label={t('quiz.title')}>
              <span class="pos">
                {t('quiz.question', { n: quiz.questionIndex + 1, total: quiz.questionCount })}
              </span>
              {#if quiz.phase === 'question'}
                <Button variant="secondary" size="sm" onclick={() => store?.revealQuiz()}>
                  {t('quiz.reveal')}
                </Button>
              {/if}
              <Button variant="secondary" size="sm" onclick={() => store?.nextQuiz()}>
                {t('quiz.next')}
                <Icon name="forward" size={16} />
              </Button>
              <Button variant="danger-ghost" size="sm" onclick={() => store?.finishQuiz()}>
                {t('quiz.finish')}
              </Button>
            </div>
          {:else if hasQuiz}
            <div class="group">
              <Button variant="secondary" size="sm" onclick={() => store?.startQuiz()}>
                <Icon name="star" size={16} />
                {t('quiz.start')}
              </Button>
            </div>
          {/if}

          <div class="group screens">
            <Button
              variant="secondary"
              size="sm"
              disabled={session.screenIndex === 0}
              aria-label={t('common.prev')}
              onclick={() => go(-1)}
            >
              <Icon name="back" size={16} />
            </Button>
            <span class="pos">{t('session.screen', { index: session.screenIndex + 1, count })}</span
            >
            <Button
              variant="secondary"
              size="sm"
              disabled={session.screenIndex >= count - 1}
              aria-label={t('common.next')}
              onclick={() => go(1)}
            >
              <Icon name="forward" size={16} />
            </Button>
          </div>

          {#snippet trail()}
            <div class="modes" role="group" aria-label={t('session.mode')}>
              <button
                type="button"
                class:active={session.mode === 'presentation'}
                aria-pressed={session.mode === 'presentation'}
                onclick={() => store?.setMode('presentation')}
              >
                {t('session.mode.presentation')}
              </button>
              <button
                type="button"
                class:active={session.mode === 'free'}
                aria-pressed={session.mode === 'free'}
                onclick={() => store?.setMode('free')}
              >
                {t('session.mode.free')}
              </button>
            </div>
            <button
              type="button"
              class="pill"
              class:on={scenarioOpen}
              aria-pressed={scenarioOpen}
              onclick={() => (scenarioOpen = !scenarioOpen)}
            >
              {scenarioOpen ? t('session.scenario.hide') : t('session.scenario.show')}
            </button>
            <button
              type="button"
              class="pill"
              class:on={session.demoSpeed > 1}
              aria-pressed={session.demoSpeed > 1}
              title={t('stage.demoSpeed')}
              onclick={() => store?.setDemoSpeed(session.demoSpeed > 1 ? 1 : 10)}
            >
              {session.demoSpeed > 1 ? t('stage.demoSpeed.on') : t('stage.demoSpeed.off')}
            </button>
          {/snippet}
        </Toolbar>
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
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('common.close')}
                onclick={() => (scenarioOpen = false)}
              >
                <Icon name="close" size={16} />
              </Button>
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
          <h2 class="boxtitle">
            <Icon name="lock" size={16} />
            {t('session.lock')}
          </h2>
          <input
            type="text"
            bind:value={lockText}
            placeholder={t('session.lock.text')}
            aria-label={t('session.lockText')}
          />
          <Button variant="danger" size="lg" block onclick={() => lock('all')}>
            {t('session.lock.all')}
          </Button>
          <div class="lockbtns">
            <Button
              variant="secondary"
              size="sm"
              disabled={selected.length === 0}
              onclick={() => lock(selected)}
            >
              {t('session.lock.selected')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={selected.length === 0}
              onclick={() => store?.unlock(selected)}
            >
              {t('session.unlock.selected')}
            </Button>
            <Button variant="secondary" size="sm" onclick={() => store?.unlock('all')}>
              {t('session.unlock.all')}
            </Button>
          </div>
          {#if inClassroom > 0}
            <p class="soft">{t('session.lock.real', { count: inClassroom })}</p>
          {/if}
          {#if inBrowser > 0 || inClassroom === 0}
            <p class="soft">{t('session.lock.soft')}</p>
          {/if}
        </div>

        <!-- "Мой экран" and a child's screen to the class (H14, CLAUDE.md §4.4). -->
        <div class="lockbox demobox">
          <h2 class="boxtitle">
            <Icon name="screen" size={16} />
            {t('share.title')}
          </h2>
          {#if demoNow}
            <p class="soft">
              {demoNow.source === 'teacher'
                ? t('share.on.mine')
                : t('share.on.child', { name: session?.participants[demoNow.source]?.name ?? '' })}
              · {demoNow.mode === 'fullscreen' ? t('share.fullscreen') : t('share.window')}
            </p>
            {#if demoNow.source !== 'teacher' && store}
              <!-- What the class sees of the child's screen. -->
              {#await import('../../lib/ui/ScreenView.svelte') then { default: ScreenView }}
                <div class="demoview"><ScreenView {store} demo={demoNow} /></div>
              {/await}
            {/if}
            <Button variant="danger" block onclick={() => store?.demoStop()}
              >{t('share.stop')}</Button
            >
          {:else if canShareMine}
            <div class="lockbtns">
              <Button size="sm" onclick={() => store?.demoStart('fullscreen', 'teacher')}>
                {t('share.mine.fullscreen')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onclick={() => store?.demoStart('window', 'teacher')}
              >
                {t('share.mine.window')}
              </Button>
            </div>
          {:else}
            <p class="soft">{t('share.appOnly')}</p>
          {/if}
        </div>

        <h2>
          {t('session.participants')}
          <span class="muted">({participants.filter((p) => p.online).length})</span>
        </h2>
        {#if participants.length === 0}
          <EmptyState
            icon="student"
            title={t('session.participants.none')}
            text={t('session.joinHint')}
          />
        {:else}
          {#each store?.moves ?? [] as m (m.n)}
            <div class="moved">
              <Notice kind="warn">{moveText(m)}</Notice>
              <button
                type="button"
                class="act"
                aria-label={t('common.close')}
                title={t('common.close')}
                onclick={() => store?.dismissMove(m.n)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          {/each}
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
            {#if inClassroom > 0}
              <!-- Screens of classroom computers (H5): the selected ones, or everybody's. -->
              <button
                type="button"
                class="link"
                onclick={() => store?.screenshot(selected.length ? selected : 'all')}
              >
                {selected.length ? t('session.shot.selected') : t('session.shot.all')}
              </button>
            {/if}
          </div>
          {#if inClassroom > 0}
            <div class="order" role="group" aria-label={t('session.order')}>
              <button
                type="button"
                class="link"
                aria-pressed={order === 'list'}
                onclick={() => setOrder('list')}>{t('session.order.list')}</button
              >
              <button
                type="button"
                class="link"
                aria-pressed={order === 'seats'}
                onclick={() => setOrder('seats')}>{t('session.order.seats')}</button
              >
            </div>
          {/if}
          <div class="tiles">
            {#each tiles as p (p.id)}
              <div
                class="tile"
                class:offline={!p.online}
                class:selected={selected.includes(p.id)}
                class:locked={isLocked(p)}
              >
                <button
                  type="button"
                  class="pick"
                  aria-pressed={selected.includes(p.id)}
                  onclick={() => toggleSelect(p.id)}
                >
                  {#if store?.thumbs[p.id]}
                    <img class="thumb" src={store.thumbs[p.id]} alt={t('session.thumb')} />
                  {/if}
                  <div class="tname">
                    <span class="dot" class:on={p.online}></span>
                    {p.name ?? t('session.participant', { number: p.number })}
                    {#if p.pc}<span class="pcname">{p.pc}</span>{/if}
                    {#if p.virtual}<span class="virt" title={t('virtual.badge')}
                        >{t('virtual.short')}</span
                      >{/if}
                  </div>
                  <div class="tmeta">
                    <span>
                      {#if stepScreens.length > 0 && stepOf(p) > 0}
                        {t('session.step', { n: stepOf(p), total: stepScreens.length })}
                      {:else}
                        {t('session.screenShort', { index: p.screenIndex + 1 })}
                      {/if}
                    </span>
                    <span class="stars">{t('session.stars', { count: p.stars })}</span>
                  </div>
                  {#if quiz}
                    <div class="tmeta">
                      <span class="stars">
                        {t('quiz.score', { points: quiz.scores[p.id] ?? 0 })}
                      </span>
                      <span>
                        {quiz.answers[p.id] ? t('quiz.accepted') : ''}
                      </span>
                    </div>
                  {/if}
                  {#if stepScreens.length > 0}
                    <div class="tmeta">
                      <span>
                        {t('session.steps', {
                          done: p.steps.length,
                          total: stepScreens.length,
                        })}
                      </span>
                    </div>
                  {/if}
                  <div class="flags">
                    {#if p.hand}<span class="flag hand">{t('session.hand')}</span>{/if}
                    {#if p.hidden}<span class="flag away">{t('session.hidden')}</span>{/if}
                    {#if p.escapes > 0}<span class="flag away"
                        >{t('session.escapes', { count: p.escapes })}</span
                      >{/if}
                    {#if !p.online}<span class="flag">{t('session.offline')}</span>{/if}
                  </div>
                </button>
                <div class="acts">
                  {#if store?.thumbs[p.id]}
                    <button
                      type="button"
                      class="act"
                      title={t('session.zoom')}
                      aria-label={t('session.zoom')}
                      onclick={() => (zoomed = p.id)}
                    >
                      <Icon name="screen" size={16} />
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="act"
                    class:on={isLocked(p)}
                    disabled={isLocked(p) && lockedAll}
                    title={isLocked(p)
                      ? lockedAll
                        ? t('session.unlock.blocked')
                        : t('session.unlock.one')
                      : t('session.lock.one')}
                    aria-label={isLocked(p) ? t('session.unlock.one') : t('session.lock.one')}
                    onclick={() => toggleLockOne(p)}
                  >
                    <Icon name={isLocked(p) ? 'unlock' : 'lock'} size={16} />
                  </button>
                  {#if p.hand}
                    <button
                      type="button"
                      class="act hand"
                      title={t('session.handDown')}
                      aria-label={t('session.handDown')}
                      onclick={() => store?.clearHand(p.id)}
                    >
                      <Icon name="hand" size={16} />
                    </button>
                  {/if}
                </div>
                {#if showStars}
                  <!-- Stars for the drawing, right on the tile: the teacher walks the room with them. -->
                  <div class="give" role="group" aria-label={t('session.practiceStars')}>
                    {#each [1, 2, 3] as n (n)}
                      <button
                        type="button"
                        class="star"
                        class:on={(p.practiceStars ?? 0) >= n}
                        aria-pressed={(p.practiceStars ?? 0) >= n}
                        aria-label={t('session.stars', { count: n })}
                        onclick={() => store?.setStars(p.id, p.practiceStars === n ? 0 : n)}
                      >
                        <Icon name="star" size={16} />
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </aside>
    </div>
  {/if}
</div>

<!-- One screen, large (H8). Esc closes it as well: the dialog's own "cancel". -->
<dialog
  class="zoom"
  bind:this={zoomDialog}
  aria-label={t('session.zoom')}
  onclose={() => (zoomed = null)}
>
  {#if zoomedP}
    <div class="zhead">
      <b>{zoomedP.name ?? t('session.participant', { number: zoomedP.number })}</b>
      {#if zoomedP.pc}<span class="pcname">{zoomedP.pc}</span>{/if}
      <button
        type="button"
        class="act"
        aria-label={t('common.close')}
        title={t('common.close')}
        onclick={() => (zoomed = null)}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
    {#if store?.thumbs[zoomedP.id]}
      <img class="zimg" src={store.thumbs[zoomedP.id]} alt={t('session.thumb')} />
    {/if}
    <div class="zacts">
      <Button
        variant={isLocked(zoomedP) ? 'secondary' : 'danger'}
        disabled={isLocked(zoomedP) && lockedAll}
        onclick={() => zoomedP && toggleLockOne(zoomedP)}
      >
        {isLocked(zoomedP) ? t('session.unlock.one') : t('session.lock.one')}
      </Button>
      {#if zoomedP.pc}
        <Button variant="secondary" onclick={() => zoomedP && store?.screenshot([zoomedP.id])}>
          {t('session.shot.one')}
        </Button>
        <!-- A good piece of work, to everybody (H14, "Экран ученика"). -->
        <Button
          variant="secondary"
          onclick={() => {
            if (zoomedP) store?.demoStart('fullscreen', zoomedP.id);
            zoomed = null;
          }}
        >
          {t('share.showChild')}
        </Button>
      {/if}
    </div>
  {/if}
</dialog>

<style>
  .zoom {
    width: min(92vw, 960px);
    padding: var(--space-4);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-lg);
    background: var(--c-surface);
  }
  .zoom::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
  .zhead {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .zhead .act {
    margin-left: auto;
  }
  .zimg {
    display: block;
    width: 100%;
    height: auto;
    border-radius: var(--radius);
    background: var(--c-bg-2);
  }
  .zacts {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  .moved {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .moved > :global(.notice) {
    flex: 1;
  }
  .order {
    display: flex;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
    font-size: var(--text-sm);
  }
  .order [aria-pressed='true'] {
    font-weight: 700;
    text-decoration: none;
    color: var(--c-dark);
  }
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
  /* The band is a card, so it is given room rather than being glued to the edges. */
  .left :global(.toolbar) {
    margin: var(--space-3);
    border-radius: var(--radius-lg);
  }
  .group {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .screens {
    gap: var(--space-2);
    padding-left: var(--space-3);
    border-left: 1px solid var(--c-line);
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
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .modes button {
    border: 0;
    background: transparent;
    padding: 0 var(--space-3);
    min-height: var(--control-sm);
    color: var(--c-muted);
    font-weight: 600;
  }
  .modes .active {
    background: var(--c-teal);
    color: #fff;
  }
  /* A switch that stays on: the scenario pane, the demo speed. */
  .pill {
    min-height: var(--control-sm);
    padding: 0 var(--space-3);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius-pill);
    background: var(--c-surface);
    color: var(--c-muted);
    font-weight: 600;
  }
  .pill.on {
    background: var(--c-dark);
    color: #fff;
    border-color: var(--c-dark);
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
    /* Its own scroll: the grid row is the viewport height, so a class of 20 still reaches the end. */
    overflow: auto;
    padding: var(--space-3);
    background: var(--c-bg-2);
  }
  /* "Внимание!" is the one red thing on the panel, and it stays at the top. */
  .lockbox {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-5);
    padding: var(--space-3);
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-lg);
  }
  .boxtitle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-md);
    color: var(--c-danger-strong);
  }
  .demoview {
    aspect-ratio: 16 / 9;
    border-radius: var(--radius);
    overflow: hidden;
    margin-bottom: var(--space-2);
  }
  .lockbox input {
    min-height: var(--control);
    padding: 0 var(--space-3);
    border: 1px solid var(--c-field-line);
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
    /* Equal rows: a name on two lines must not make its neighbour taller than the rest. */
    grid-auto-rows: 1fr;
    gap: var(--space-2);
  }
  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sm);
  }
  .pick {
    width: 100%;
    /* Fills what the stars leave, instead of covering them: the tile is a column. */
    flex: 1;
    text-align: left;
    background: none;
    border: 0;
    border-radius: var(--radius);
    /* Room on the right for the per-student actions. */
    padding: var(--space-2) var(--control) var(--space-2) var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .acts {
    position: absolute;
    top: var(--space-1);
    right: var(--space-1);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .act {
    display: grid;
    place-items: center;
    width: var(--control-sm);
    height: var(--control-sm);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius);
    background: var(--c-surface);
    color: var(--c-muted);
    cursor: pointer;
  }
  .act:hover:not(:disabled) {
    border-color: var(--c-muted);
    color: var(--c-dark);
  }
  .act.on {
    background: var(--c-danger-soft);
    border-color: var(--c-danger);
    color: var(--c-danger-strong);
  }
  .act.hand {
    background: var(--c-accent);
    border-color: var(--c-accent);
    color: #fff;
  }
  .act:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .tile.selected {
    border-color: var(--c-accent);
    box-shadow: 0 0 0 1px var(--c-accent);
  }
  .tile.locked {
    background: var(--c-danger-soft);
  }
  .tile.offline {
    opacity: 0.55;
  }
  /* Small and quiet: the class is the point, not which child the server plays. */
  .virt {
    margin-left: var(--space-1);
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    background: var(--c-info-soft);
    color: var(--c-info);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .thumb {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 10;
    object-fit: cover;
    margin-bottom: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--c-bg-2);
  }
  .pcname {
    margin-left: var(--space-1);
    color: var(--c-muted);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .tname {
    font-weight: 700;
    color: var(--c-dark);
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--c-line-strong);
    flex: none;
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
  .give {
    display: flex;
    gap: var(--space-1);
    padding: 0 var(--space-2) var(--space-2);
  }
  .star {
    display: grid;
    place-items: center;
    width: var(--control-sm);
    height: var(--control-sm);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius);
    background: var(--c-surface);
    color: var(--c-line-strong);
  }
  .star.on {
    background: #fff4e5;
    border-color: var(--c-star);
    color: var(--c-star-ink);
  }
  .stars {
    color: var(--c-star-ink);
    font-weight: 700;
  }
  .flags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    font-size: var(--text-xs);
  }
  .flag {
    background: var(--c-bg-2);
    color: var(--c-muted);
    border-radius: var(--radius-pill);
    padding: 1px var(--space-2);
    font-weight: 600;
  }
  .flag.hand {
    background: #fff4e5;
    color: #8a5a00;
  }
  .flag.away {
    background: var(--c-danger-soft);
    color: var(--c-danger-strong);
  }
  @media (max-width: 1100px) {
    .panel {
      grid-template-columns: minmax(0, 1fr) 300px;
    }
  }
</style>
