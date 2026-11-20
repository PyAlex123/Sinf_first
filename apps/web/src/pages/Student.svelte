<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '../lib/api.js';
  import { stageScreenRange } from '@sinf/shared';
  import { loadLessonBundle, type LessonBundle } from '../lib/content.js';
  import { t } from '../lib/i18n/index.svelte.js';
  import { hostSend, platform } from '../lib/platform.js';
  import { router, type PageProps } from '../lib/router.svelte.js';
  import { readParticipantToken, SessionStore } from '../lib/stores/session.svelte.js';
  import { QUIZ_OPTION_LETTERS } from '@sinf/shared';
  import Button from '../lib/ui/Button.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import QuizOption from '../lib/ui/QuizOption.svelte';
  import { speak } from '../player/lib/speech.js';
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

  /**
   * In the classroom app "Attention!" is real (H4): the app stops keyboard and mouse while the
   * curtain is up. In a browser this sends nothing — the curtain is all there is.
   */
  $effect(() => {
    const on = !!lock && !ended;
    hostSend({ type: 'lock', on });
    return () => hostSend({ type: 'lock', on: false });
  });
  const ended = $derived(endedBefore || session?.status === 'ended' || store?.status === 'ended');

  /**
   * On a classroom computer (stage 3, H2) the lesson is not the end: after a moment the screen goes
   * back to waiting for the next one. In a browser the child sees "the lesson is over" and stays.
   */
  const BACK_TO_WAITING_MS = 5000;
  $effect(() => {
    if (!ended || platform.role !== 'student') return;
    const timer = setTimeout(() => router.navigate('/join', { replace: true }), BACK_TO_WAITING_MS);
    return () => clearTimeout(timer);
  });
  const kicked = $derived(store?.kicked === true);
  const free = $derived(session?.mode === 'free');
  /** During the rest part of practice the screen is covered (STAGE1 S1.8). */
  const resting = $derived(session?.stage.part === 'rest');
  /**
   * A step of the Paint practice (S1.11): the child works in Paint and tells the teacher when the
   * step is done. It is shown whoever drives the screens, because the work happens off-screen.
   */
  const step = $derived.by(() => {
    if (!bundle) return null;
    const screen = bundle.lesson.screens[index];
    return screen?.kind === 'step' ? screen : null;
  });
  const stepDone = $derived(!!me?.steps.includes(index));

  /**
   * The live quiz (S1.12). While it is on, it is the whole screen: the lesson waits, and the child
   * has four big buttons and nothing else to think about.
   */
  const quiz = $derived(session?.quiz ?? null);
  const question = $derived(
    quiz && bundle?.quiz ? (bundle.quiz.questions[quiz.questionIndex] ?? null) : null,
  );
  const myAnswer = $derived(me && quiz ? (quiz.answers[me.id] ?? null) : null);
  const myScore = $derived(me && quiz ? (quiz.scores[me.id] ?? 0) : 0);

  // A new question is read aloud once, the way the trainer reads its tasks.
  let spokenQuestion = $state(-1);
  $effect(() => {
    if (!question || !quiz || quiz.phase !== 'question') return;
    if (spokenQuestion === quiz.questionIndex) return;
    spokenQuestion = quiz.questionIndex;
    speak(question.say);
  });

  function optionState(i: number): 'idle' | 'chosen' | 'correct' | 'wrong' | 'dim' {
    if (!quiz || !question) return 'idle';
    if (quiz.phase === 'question') return myAnswer?.optionIndex === i ? 'chosen' : 'idle';
    if (i === question.correct) return 'correct';
    return myAnswer?.optionIndex === i ? 'wrong' : 'dim';
  }

  /** In free mode a student walks through the screens of the current stage only (S1.9). */
  const range = $derived.by(() => {
    if (!session || !bundle || session.mode !== 'free') return null;
    const key = bundle.lesson.stages[session.stage.index]?.key;
    return stageScreenRange(
      bundle.lesson.screens.map((screen) => screen.stage),
      key,
    );
  });

  // In presentation mode the teacher drives the screen; in free mode the student keeps their own place.
  $effect(() => {
    if (session && session.mode === 'presentation') index = session.screenIndex;
  });

  /** The classroom app's window already covers the screen (stage 3): nothing to press there. */
  const inClassroomApp = platform.role === 'student';

  function start(): void {
    started = true;
    const root = document.documentElement;
    if (!inClassroomApp && root.requestFullscreen) {
      root.requestFullscreen().catch(() => undefined);
    }
    store?.connect();
  }

  function report(): void {
    store?.visibility(document.hidden, inClassroomApp || !!document.fullscreenElement);
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
        if (inClassroomApp) start();
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
      {#if quiz && question}
        <main class="quiz">
          <p class="qnum muted">
            {t('quiz.question', { n: quiz.questionIndex + 1, total: quiz.questionCount })}
          </p>
          <h1 class="qtext">{question.text}</h1>
          <div class="opts" class:two={question.options.length <= 2}>
            {#each question.options as option, i (i)}
              <QuizOption
                {option}
                index={i}
                pics={bundle.pics}
                big
                state={optionState(i)}
                onclick={quiz.phase === 'question' && !myAnswer
                  ? () => store?.answerQuiz(quiz.questionIndex, i)
                  : undefined}
              />
            {/each}
          </div>
          <div class="qfoot">
            {#if quiz.phase === 'question'}
              {#if myAnswer}
                <span class="said">{t('quiz.accepted')}</span>
              {:else}
                <button type="button" class="say" onclick={() => speak(question.say)}>
                  🔊 {t('quiz.repeat')}
                </button>
              {/if}
            {:else if myAnswer && myAnswer.optionIndex === question.correct}
              <span class="said ok">{t('quiz.correct', { points: myAnswer.points })}</span>
            {:else if myAnswer}
              <span class="said no">
                {t('quiz.wrong', { letter: QUIZ_OPTION_LETTERS[question.correct] ?? '' })}
              </span>
            {:else}
              <!-- Не ответил вовсе — упрекать не за что, просто показываем верный. -->
              <span class="said">
                {t('quiz.rightIs', { letter: QUIZ_OPTION_LETTERS[question.correct] ?? '' })}
              </span>
            {/if}
            <span class="score">{t('quiz.score', { points: myScore })}</span>
          </div>
        </main>
      {:else}
        <LessonPlayer
          lesson={bundle.lesson}
          course={bundle.course}
          pics={bundle.pics}
          bind:index
          navigation={free ? 'free' : 'locked'}
          {range}
          frozen={!!lock || resting}
          doneScreens={me?.doneScreens ?? []}
          stars={me?.stars ?? 0}
          onNavigate={(i: number) => store?.setScreen(i)}
          onScreenDone={(i: number, stars: number) => store?.screenDone(i, stars)}
        />
      {/if}
      {#if resting}
        <RestScreen />
      {/if}
      {#if step && !lock && !resting}
        <div class="steps">
          <button
            type="button"
            class="did"
            class:on={stepDone}
            onclick={() => store?.stepDone(index, !stepDone)}
          >
            <Icon name={stepDone ? 'check' : 'forward'} size={20} />
            {stepDone ? t('step.done') : t('step.do')}
          </button>
          <button
            type="button"
            class="help"
            class:up={me?.hand}
            onclick={() => store?.hand(!me?.hand)}
          >
            <Icon name="hand" size={20} />
            {me?.hand ? t('step.helpCalled') : t('step.help')}
          </button>
        </div>
      {/if}
      <div class="hud" class:raised={!!step || !!quiz}>
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
        {#if !step && !quiz}
          <!-- On a step the child has their own "Помогите" button below; one hand is enough.
               During a quiz nothing may sit on top of an answer. -->
          <button
            type="button"
            class="hand"
            class:up={me?.hand}
            onclick={() => store?.hand(!me?.hand)}
          >
            <Icon name="hand" />
            {me?.hand ? t('student.handDown') : t('student.hand')}
          </button>
        {/if}
      </div>
      {#if lock}
        <div class="lock" role="alert">
          <Icon name="lock" size={64} />
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
  }
  /* The practice buttons and the quiz take the bottom strip, so the badges move above them. */
  .hud.raised {
    bottom: calc(var(--tap) * 2 + var(--space-6));
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2);
    z-index: 40;
  }
  .num,
  .conn {
    background: rgba(19, 35, 58, 0.85);
    color: #fff;
    border-radius: var(--radius-pill);
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .conn {
    background: var(--c-danger);
  }
  .hand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap);
    padding: 0 var(--space-4);
    border-radius: var(--radius-pill);
    border: 2px solid #fff;
    background: var(--c-teal);
    color: #fff;
    font-weight: 700;
    font-size: var(--text-md);
    box-shadow: var(--shadow-lg);
  }
  .hand.up {
    background: var(--c-accent);
  }
  /* The quiz owns the screen while it runs: question on top, four buttons under the thumb. */
  .quiz {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--c-bg);
    overflow: auto;
  }
  .qnum {
    margin: 0;
  }
  .qtext {
    margin: 0;
    font-size: var(--text-xl);
    text-wrap: balance;
  }
  .opts {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
    min-height: 0;
  }
  .opts.two {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr;
  }
  .qfoot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .say {
    min-height: var(--tap);
    padding: 0 var(--space-4);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius-pill);
    background: var(--c-surface);
    font-weight: 700;
    font-size: var(--text-lg);
    color: var(--c-dark);
  }
  .said {
    font-size: var(--text-lg);
    font-weight: 800;
    color: var(--c-dark);
  }
  .said.ok {
    color: var(--c-ok);
  }
  .said.no {
    color: var(--c-danger);
  }
  .score {
    font-weight: 700;
    color: var(--c-muted);
  }

  /* The two buttons of the practice: big, low on the screen, away from the lesson itself. */
  .steps {
    position: fixed;
    left: 50%;
    /* Above the lesson's own "Назад / Дальше" bar, which is one tap target tall. */
    bottom: calc(var(--tap) + var(--space-5));
    transform: translateX(-50%);
    display: flex;
    gap: var(--space-3);
    z-index: 45;
  }
  .steps button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap);
    padding: 0 var(--space-5);
    border-radius: var(--radius-pill);
    border: 2px solid #fff;
    font-weight: 700;
    font-size: var(--text-lg);
    color: #fff;
    box-shadow: var(--shadow-lg);
  }
  .did {
    background: var(--c-accent);
  }
  .did.on {
    background: var(--c-ok);
  }
  .help {
    background: var(--c-teal);
  }
  .help.up {
    background: var(--c-star);
    color: var(--c-dark);
  }
  @media (max-width: 560px) {
    .steps button {
      min-height: var(--control-lg);
      padding: 0 var(--space-4);
      font-size: var(--text-md);
    }
  }
  .lock {
    position: fixed;
    inset: 0;
    z-index: 70;
    background: var(--c-dark);
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-5);
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
      min-height: var(--control);
      padding: 0 var(--space-3);
      font-size: var(--text-sm);
    }
  }
</style>
