<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '../lib/api.js';
  import { loadLessonBundle, type LessonBundle } from '../lib/content.js';
  import { t } from '../lib/i18n/index.svelte.js';
  import type { PageProps } from '../lib/router.svelte.js';
  import { SessionStore } from '../lib/stores/session.svelte.js';
  import { QUIZ_OPTION_LETTERS } from '@sinf/shared';
  import Button from '../lib/ui/Button.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import QuizOption from '../lib/ui/QuizOption.svelte';
  import { speak } from '../player/lib/speech.js';
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

  /**
   * The live quiz (S1.12). On the projector it is the whole screen: question, time, four colours —
   * the children look up from their own screens and answer what they see here.
   */
  const quiz = $derived(session?.quiz ?? null);
  const question = $derived(
    quiz && bundle?.quiz ? (bundle.quiz.questions[quiz.questionIndex] ?? null) : null,
  );
  const answered = $derived(quiz ? Object.keys(quiz.answers).length : 0);

  /** Who is ahead: the whole table, best first; the screen takes the top of it. */
  const leaders = $derived.by(() => {
    if (!quiz) return [];
    return participants
      .map((p) => ({
        name: p.name ?? t('session.participant', { number: p.number }),
        virtual: p.virtual,
        points: quiz.scores[p.id] ?? 0,
      }))
      .sort((a, b) => b.points - a.points);
  });

  // The question is read aloud once, as the trainer reads its tasks.
  let spokenQuestion = $state(-1);
  $effect(() => {
    if (!question || !quiz || quiz.phase !== 'question') return;
    if (spokenQuestion === quiz.questionIndex) return;
    spokenQuestion = quiz.questionIndex;
    speak(question.say);
  });

  /** Seconds left of this question; it ticks locally, like the stage timer (S1.8). */
  let tick = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (tick = Date.now()), 500);
    return () => clearInterval(timer);
  });
  const secondsLeft = $derived.by(() => {
    void tick;
    if (!quiz || quiz.phase !== 'question') return 0;
    const now = store?.now() ?? Date.now();
    return Math.max(0, Math.ceil((quiz.startedAt + quiz.limitSec * 1000 - now) / 1000));
  });

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
    {#if quiz && question}
      <main class="quiz">
        {#if quiz.phase === 'podium'}
          <h1 class="big">{t('quiz.podium')}</h1>
          <ol class="podium">
            {#each leaders.slice(0, 3) as leader, i (leader.name)}
              <li class="place p{i}">
                <span class="medal">{i + 1}</span>
                <span class="who"
                  >{leader.name}{#if leader.virtual}<small class="virt">
                      {t('virtual.short')}</small
                    >{/if}</span
                >
                <span class="pts">{t('quiz.points', { count: leader.points })}</span>
              </li>
            {/each}
          </ol>
        {:else if quiz.phase === 'leaderboard'}
          <h1 class="big">{t('quiz.leaders')}</h1>
          <ol class="board">
            {#each leaders.slice(0, 5) as leader (leader.name)}
              <li>
                <span class="who"
                  >{leader.name}{#if leader.virtual}<small class="virt">
                      {t('virtual.short')}</small
                    >{/if}</span
                >
                <span class="pts">{t('quiz.points', { count: leader.points })}</span>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="qnum">
            {t('quiz.question', { n: quiz.questionIndex + 1, total: quiz.questionCount })}
          </p>
          <h1 class="qtext">{question.text}</h1>
          <div class="qopts">
            {#each question.options as option, i (i)}
              <QuizOption
                {option}
                index={i}
                pics={bundle.pics}
                big
                state={quiz.phase === 'reveal'
                  ? i === question.correct
                    ? 'correct'
                    : 'dim'
                  : 'idle'}
              />
            {/each}
          </div>
          <div class="qfoot">
            {#if quiz.phase === 'question'}
              <span class="clock">{secondsLeft}</span>
              <span>{t('quiz.answered', { count: answered, total: online })}</span>
            {:else}
              <span class="right">
                {t('quiz.rightIs', { letter: QUIZ_OPTION_LETTERS[question.correct] ?? '' })}
              </span>
            {/if}
          </div>
        {/if}
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
    {/if}
    <div class="hud">
      <span class="stagename">{bundle.lesson.stages[session.stage.index]?.title ?? ''}</span>
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
      <Button
        variant="secondary"
        size="sm"
        onclick={toggleFullscreen}
        aria-label={t('present.fullscreen')}
      >
        <Icon name="screen" />
      </Button>
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
  /* The quiz on the projector: readable from the back row. */
  .quiz {
    height: 100vh;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6);
    background: var(--c-bg);
  }
  .qnum {
    margin: 0;
    font-size: var(--text-xl);
    color: var(--c-muted);
  }
  .qtext {
    margin: 0;
    font-size: clamp(32px, 5vw, 64px);
    text-wrap: balance;
  }
  .qopts {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--space-4);
    min-height: 0;
  }
  .qfoot {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    font-size: var(--text-xl);
    color: var(--c-muted);
  }
  .clock {
    min-width: 2.5ch;
    text-align: center;
    font-size: var(--text-3xl);
    font-weight: 900;
    color: var(--c-dark);
    font-variant-numeric: tabular-nums;
  }
  .right {
    font-size: var(--text-2xl);
    font-weight: 800;
    color: var(--c-ok);
  }
  .big {
    margin: 0;
    font-size: clamp(40px, 6vw, 72px);
    text-align: center;
  }
  .board,
  .podium {
    list-style: none;
    margin: 0 auto;
    padding: 0;
    width: min(100%, 720px);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .board li,
  .place {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-5);
    background: var(--c-surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    font-size: var(--text-2xl);
  }
  .board .who,
  .place .who {
    flex: 1;
    font-weight: 700;
    color: var(--c-dark);
  }
  .pts {
    color: var(--c-star-ink);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .medal {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: var(--radius-pill);
    background: var(--c-bg-2);
    font-weight: 900;
  }
  .p0 .medal {
    background: #f2c14e;
  }
  .p1 .medal {
    background: #d7dde5;
  }
  .p2 .medal {
    background: #e0a46b;
  }

  .hud .code b {
    color: var(--c-dark);
  }
  .stagename {
    color: var(--c-accent);
    font-weight: 700;
    text-transform: lowercase;
  }
  .hud {
    position: fixed;
    top: var(--space-2);
    right: var(--space-2);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid var(--c-line);
    box-shadow: var(--shadow);
    border-radius: var(--radius-pill);
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-4);
    color: var(--c-dark);
    font-weight: 600;
    z-index: 40;
  }
  .virt {
    margin-left: 0.4em;
    font-size: 0.5em;
    font-weight: 600;
    opacity: 0.7;
  }
</style>
