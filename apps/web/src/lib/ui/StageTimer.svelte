<script lang="ts">
  import { remainingMs, type SessionState, type Stage } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { t } from '../i18n/index.svelte.js';

  /**
   * Lesson timer drawn from the session state and the server clock (S1.8): it ticks locally between
   * `stage.changed` messages, so the number moves every second without any traffic.
   */
  let {
    session,
    stages,
    now,
    compact = false,
  }: {
    session: SessionState;
    stages: readonly Stage[];
    /** Server time; the page passes `store.now`. */
    now: () => number;
    compact?: boolean;
  } = $props();

  let tick = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => (tick = Date.now()), 500);
    return () => clearInterval(timer);
  });

  const stage = $derived(stages[session.stage.index]);
  const left = $derived.by(() => {
    void tick; // re-read every tick
    return remainingMs(session, stages, now()) ?? 0;
  });
  const paused = $derived(session.stage.pausedAt !== null);
  const resting = $derived(session.stage.part === 'rest');
  const countdownSec = $derived.by(() => {
    void tick;
    const until = session.stage.countdownUntil;
    return until === null ? null : Math.max(0, Math.ceil((until - now()) / 1000));
  });

  function format(ms: number): string {
    const total = Math.ceil(ms / 1000);
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
  }
</script>

<div class="timer" class:compact class:paused class:resting>
  {#if !compact}
    <span class="stage">
      {stage?.title ?? ''}
      <small>{t('stage.of', { n: session.stage.index + 1, total: stages.length })}</small>
    </span>
  {/if}
  <span class="line">
    <span class="clock">{format(left)}</span>
    {#if paused}
      <span class="badge">{t('stage.paused')}</span>
    {:else if resting}
      <span class="badge rest">{t('stage.rest')}</span>
    {:else if countdownSec !== null}
      <span class="badge count">{t('stage.countdown', { sec: countdownSec })}</span>
    {/if}
    {#if session.demoSpeed > 1}
      <span class="badge speed">×{session.demoSpeed}</span>
    {/if}
  </span>
</div>

<style>
  .timer {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    white-space: nowrap;
  }
  .timer:not(.compact) {
    /* On the teacher's panel the time left is the most important number on the screen. */
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
  }
  .stage {
    color: var(--c-muted);
    font-weight: 600;
    font-size: var(--text-sm);
  }
  .stage small {
    font-weight: 400;
    margin-left: var(--space-1);
  }
  .clock {
    font-variant-numeric: tabular-nums;
    font-weight: 800;
    font-size: var(--text-xl);
    line-height: var(--leading-tight);
    color: var(--c-dark);
  }
  .compact .clock {
    font-size: var(--text-md);
  }
  .paused .clock {
    color: var(--c-muted);
  }
  .badge {
    font-size: var(--text-sm);
    font-weight: 600;
    border-radius: var(--radius-pill);
    padding: 2px var(--space-2);
    background: var(--c-bg-2);
    color: var(--c-muted);
  }
  .badge.count {
    background: var(--c-accent);
    color: #fff;
    font-weight: 700;
  }
  .badge.rest {
    background: #ede3ff;
    color: #6a32b0;
    font-weight: 700;
  }
  .badge.speed {
    background: var(--c-teal);
    color: #fff;
  }
  .line {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
</style>
