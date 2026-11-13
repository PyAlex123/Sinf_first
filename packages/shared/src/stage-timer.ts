import type { Stage } from './lesson.js';
import type { SessionState, StageState } from './protocol.js';

/**
 * Lesson time arithmetic (STAGE1 S1.8). All of it is pure: the server runs the timer and the clients draw the
 * same numbers from the same state, using the server clock offset they got with the snapshot.
 *
 * Lesson time runs `demoSpeed` times faster than real time: at speed 10 one lesson minute takes six seconds.
 * "+5 min" adds lesson milliseconds, a pause freezes the clock.
 */

export const MS_PER_MIN = 60_000;
/** Countdown shown before a stage switches by itself (lesson seconds). */
export const COUNTDOWN_SEC = 10;

export function stageDurationMs(stage: Stage): number {
  return (stage.endMin - stage.startMin) * MS_PER_MIN;
}

/** Lesson milliseconds elapsed in the current stage. */
export function elapsedMs(stage: StageState, demoSpeed: number, now: number): number {
  const until = stage.pausedAt ?? now;
  return Math.max(0, (until - stage.startedAt) * demoSpeed);
}

/** Lesson milliseconds left in the current stage, including "+5 min"; `null` without a stage list. */
export function remainingMs(
  state: SessionState,
  stages: readonly Stage[],
  now: number,
): number | null {
  const stage = stages[state.stage.index];
  if (!stage) return null;
  const total = stageDurationMs(stage) + state.stage.extraMs;
  return Math.max(0, total - elapsedMs(state.stage, state.demoSpeed, now));
}

/** Real milliseconds until the stage ends (for scheduling a server timer); `null` when paused or unknown. */
export function realMsUntilStageEnd(
  state: SessionState,
  stages: readonly Stage[],
  now: number,
): number | null {
  if (state.stage.pausedAt !== null) return null;
  const left = remainingMs(state, stages, now);
  return left === null ? null : Math.ceil(left / state.demoSpeed);
}

/** Which part of a split stage (practice: work → rest → work) the lesson is in now. */
export function partAt(stage: Stage | undefined, elapsed: number): 'work' | 'rest' | null {
  if (!stage?.parts) return null;
  let bound = 0;
  for (const part of stage.parts) {
    bound += part.minutes * MS_PER_MIN;
    if (elapsed < bound) return part.kind;
  }
  return stage.parts.at(-1)?.kind ?? null;
}

/** Real milliseconds until the part of a split stage changes; `null` if there is nothing more to switch to. */
export function realMsUntilPartChange(
  state: SessionState,
  stages: readonly Stage[],
  now: number,
): number | null {
  const stage = stages[state.stage.index];
  if (!stage?.parts || state.stage.pausedAt !== null) return null;
  const elapsed = elapsedMs(state.stage, state.demoSpeed, now);
  let bound = 0;
  for (const part of stage.parts) {
    bound += part.minutes * MS_PER_MIN;
    if (elapsed < bound) return Math.ceil((bound - elapsed) / state.demoSpeed);
  }
  return null;
}

/** Fresh stage state when a stage starts (or restarts after "back"). */
export function startStage(index: number, now: number, part: 'work' | 'rest' | null): StageState {
  return { index, startedAt: now, pausedAt: null, extraMs: 0, countdownUntil: null, part };
}

/** Mode the lesson switches to when a stage starts: theory is shown by the teacher, practice is free work. */
export function modeForStage(stage: Stage | undefined): 'presentation' | 'free' {
  return stage?.place === 'computer' ? 'free' : 'presentation';
}

/** First screen of a stage, or the current one if the stage has no screens of its own. */
export function firstScreenOfStage(
  screenStages: readonly string[],
  stageKey: string | undefined,
  fallback: number,
): number {
  if (!stageKey) return fallback;
  const index = screenStages.indexOf(stageKey);
  return index >= 0 ? index : fallback;
}
