import type { FastifyBaseLogger } from 'fastify';
import {
  lockFor,
  PROTOCOL_VERSION,
  stageScreenRange,
  type ClientMessage,
  type Lesson,
  type LessonPlan,
  type Participant,
  type SessionState,
} from '@sinf/shared';
import type { ContentStore } from '../content/index.js';
import type { Connection, RoomSocket, SessionStore } from '../realtime/session-store.js';

/**
 * Virtual students (S1.15, ADR-013): a teacher alone shows a lesson to a "live" class.
 *
 * They live on the server, not in browser tabs, so one laptop carries twenty of them. Each one logs
 * in through `loginStudent` and `attach` exactly as a child does, holds a socket of its own and
 * sends the very protocol messages the student page sends. The engine, the teacher's tiles, the
 * results and the journal therefore see an ordinary participant — with the `virtual` mark.
 *
 * Nothing here runs on its own clock: `tick(now)` decides what each one does next, a timer calls it
 * twice a second, and tests call it themselves with a fixed random source.
 */

export interface VirtualStudentRow {
  id: string;
  firstName: string;
  lastName: string;
  sortOrder: number;
}

/** How one child behaves for the whole lesson: speed, how well trainers go, how restless. */
interface Profile {
  /** Lesson time spent on one screen before the next action. */
  paceMs: number;
  /** Chance to solve a trainer (stars) rather than give up on it. */
  skill: number;
  /** Chance to answer a quiz question right; around 0.7 across the class. */
  quizSkill: number;
  /** Chance per action to slip away from the tab for a few seconds. */
  restless: number;
}

interface Bot {
  student: VirtualStudentRow;
  profile: Profile;
  joinAt: number;
  joined: boolean;
  socket: VirtualSocket | null;
  /** Real time of the next step through the lesson. */
  nextAt: number;
  hiddenUntil: number | null;
  handDownAt: number | null;
  /** Question being answered (`index:startedAt`) and when the answer comes. */
  quizKey: string | null;
  quizAt: number;
  /** Trainers this child gave up on: no stars there, and no second try. */
  gaveUp: Set<number>;
}

/** Timings in real milliseconds unless the name says lesson time. */
const TICK_MS = 500;
const JOIN_DELAY_MS = [2_000, 20_000] as const;
const PACE_LESSON_MS = [8_000, 25_000] as const;
const SKILL = [0.6, 0.9] as const;
const QUIZ_SKILL = [0.55, 0.85] as const;
const RESTLESS = [0.01, 0.04] as const;
const HAND_CHANCE = 0.015;
const AWAY_MS = [3_000, 10_000] as const;
const HAND_UP_MS = [15_000, 40_000] as const;
const QUIZ_DELAY_MS = [2_000, 12_000] as const;

/** The socket a virtual student holds. It hears nothing: it reads the lesson state directly. */
class VirtualSocket implements RoomSocket {
  readonly OPEN = 1;
  readyState = 1;
  connection: Connection | null = null;

  constructor(private readonly onClose: () => void) {}

  send(): void {}

  close(): void {
    if (this.readyState !== this.OPEN) return;
    this.readyState = 3;
    this.onClose();
  }

  /** The heartbeat asks; a virtual student always answers. */
  ping(): void {
    if (this.connection) this.connection.alive = true;
  }

  terminate(): void {
    this.close();
  }
}

export class VirtualStudents {
  private readonly sessions = new Map<string, Bot[]>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: SessionStore,
    private readonly content: ContentStore,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {}

  /** Puts children into a running lesson; each comes in after a few seconds of its own. */
  add(sessionId: string, students: VirtualStudentRow[]): number {
    const bots = this.sessions.get(sessionId) ?? [];
    const playing = new Set(bots.map((b) => b.student.id));
    const now = this.now();
    let added = 0;
    for (const student of students) {
      if (playing.has(student.id)) continue;
      bots.push({
        student,
        profile: {
          paceMs: this.between(PACE_LESSON_MS),
          skill: this.between(SKILL),
          quizSkill: this.between(QUIZ_SKILL),
          restless: this.between(RESTLESS),
        },
        joinAt: now + this.between(JOIN_DELAY_MS),
        joined: false,
        socket: null,
        nextAt: 0,
        hiddenUntil: null,
        handDownAt: null,
        quizKey: null,
        quizAt: 0,
        gaveUp: new Set(),
      });
      added++;
    }
    this.sessions.set(sessionId, bots);
    this.ensureTimer();
    this.log.info({ sessionId, added }, 'virtual students added');
    return added;
  }

  /** Virtual students of a lesson, those still on their way in included. */
  count(sessionId: string): number {
    return this.sessions.get(sessionId)?.length ?? 0;
  }

  /** Ids already playing in a lesson, so the same child is never added twice. */
  playing(sessionId: string): Set<string> {
    return new Set((this.sessions.get(sessionId) ?? []).map((b) => b.student.id));
  }

  /** Takes them out of a lesson: they go offline like a closed tab. */
  stop(sessionId: string): void {
    for (const bot of this.sessions.get(sessionId) ?? []) {
      if (bot.socket && bot.socket.readyState === bot.socket.OPEN) {
        const socket = bot.socket;
        bot.socket = null;
        this.store.detach(sessionId, socket);
      }
    }
    this.sessions.delete(sessionId);
    this.stopTimerIfIdle();
  }

  /**
   * Server shutdown. Nobody is taken out of a lesson: the lesson's snapshot is being saved right now,
   * and a server that comes back restores it paused with everyone offline anyway (ADR-006).
   */
  close(): void {
    this.sessions.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One look at every lesson: who comes in, who works, who answers. */
  tick(now = this.now()): void {
    for (const [sessionId, bots] of this.sessions) {
      const state = this.store.getState(sessionId);
      const plan = this.store.planOfSession(sessionId);
      const lesson = state ? this.content.getLesson(state.lessonId) : undefined;
      if (!state || state.status !== 'active' || !plan || !lesson) {
        // The lesson ended: its sockets are already closed by the store.
        this.sessions.delete(sessionId);
        continue;
      }
      for (const bot of bots) {
        try {
          this.step(sessionId, bot, now, plan, lesson);
        } catch (error) {
          this.log.warn(
            { err: error, sessionId, studentId: bot.student.id },
            'virtual step failed',
          );
        }
      }
    }
    this.stopTimerIfIdle();
  }

  // ---------- one child

  private step(sessionId: string, bot: Bot, now: number, plan: LessonPlan, lesson: Lesson): void {
    if (!bot.joined) {
      if (now >= bot.joinAt) this.join(sessionId, bot, now);
      return;
    }
    if (!bot.socket) return;
    const current = this.store.getState(sessionId);
    const p = current?.participants[bot.student.id];
    if (!current || !p) return;
    // Behind the "Attention!" curtain a child waits, like everybody else.
    if (lockFor(current, p.id)) return;

    const quiz = current.quiz;
    if (quiz) {
      if (quiz.phase === 'question' && !quiz.answers[p.id]) {
        const key = `${quiz.questionIndex}:${quiz.startedAt}`;
        if (bot.quizKey !== key) {
          bot.quizKey = key;
          const latest = quiz.limitSec * 1000 - 1000;
          bot.quizAt = quiz.startedAt + Math.min(this.between(QUIZ_DELAY_MS), latest);
        }
        const question = plan.quiz?.questions[quiz.questionIndex];
        if (now >= bot.quizAt && question) {
          const right = this.random() < bot.profile.quizSkill;
          const wrong = question.options.map((_, i) => i).filter((i) => i !== question.correct);
          const optionIndex = right
            ? question.correct
            : (wrong[Math.floor(this.random() * wrong.length)] ?? question.correct);
          this.send(sessionId, bot, now, {
            v: PROTOCOL_VERSION,
            type: 'student.quiz.answer',
            questionIndex: quiz.questionIndex,
            optionIndex,
          });
        }
      }
      // While the quiz is on, a child looks at the quiz and does nothing else.
      return;
    }

    if (bot.hiddenUntil !== null) {
      if (now < bot.hiddenUntil) return;
      bot.hiddenUntil = null;
      this.send(sessionId, bot, now, {
        v: PROTOCOL_VERSION,
        type: 'student.visibility',
        hidden: false,
        fullscreen: true,
      });
    }

    if (!p.hand) bot.handDownAt = null;
    if (p.hand && bot.handDownAt !== null && now >= bot.handDownAt) {
      // Nobody came: the hand goes down by itself, as it does in a real class.
      bot.handDownAt = null;
      this.send(sessionId, bot, now, { v: PROTOCOL_VERSION, type: 'student.hand', up: false });
    }

    if (current.stage.pausedAt !== null || now < bot.nextAt) return;
    bot.nextAt = now + (bot.profile.paceMs * this.between([0.6, 1.4])) / current.demoSpeed;

    const roll = this.random();
    if (roll < bot.profile.restless) {
      bot.hiddenUntil = now + this.between(AWAY_MS);
      this.send(sessionId, bot, now, {
        v: PROTOCOL_VERSION,
        type: 'student.visibility',
        hidden: true,
        fullscreen: true,
      });
      return;
    }
    if (roll < bot.profile.restless + HAND_CHANCE && !p.hand) {
      bot.handDownAt = now + this.between(HAND_UP_MS);
      this.send(sessionId, bot, now, { v: PROTOCOL_VERSION, type: 'student.hand', up: true });
      return;
    }
    this.work(sessionId, bot, now, current, p, plan, lesson);
  }

  /** One thing done on the current screen, or one screen onwards when there is nothing to do. */
  private work(
    sessionId: string,
    bot: Bot,
    now: number,
    state: SessionState,
    p: Participant,
    plan: LessonPlan,
    lesson: Lesson,
  ): void {
    const index = state.mode === 'presentation' ? state.screenIndex : p.screenIndex;
    const screen = lesson.screens[index];
    const trainer =
      screen && (screen.kind === 'game' || screen.kind === 'type' || screen.kind === 'question');
    if (screen && trainer && !p.doneScreens.includes(index) && !bot.gaveUp.has(index)) {
      if (screen.kind === 'question') {
        // A test has one try: a weaker child answers it too, and is wrong more often (W4).
        this.send(sessionId, bot, now, {
          v: PROTOCOL_VERSION,
          type: 'student.screen.done',
          index,
          stars: this.random() < bot.profile.skill ? 1 : 0,
        });
        return;
      }
      if (this.random() < bot.profile.skill) {
        const stars = screen.kind === 'game' ? screen.level.stars : 1;
        this.send(sessionId, bot, now, {
          v: PROTOCOL_VERSION,
          type: 'student.screen.done',
          index,
          stars,
        });
      } else {
        bot.gaveUp.add(index);
      }
      return;
    }
    if (plan.stepScreens.includes(index) && !p.steps.includes(index)) {
      this.send(sessionId, bot, now, {
        v: PROTOCOL_VERSION,
        type: 'student.step.done',
        index,
        done: true,
      });
      return;
    }
    if (state.mode !== 'free') return;
    const range = stageScreenRange(plan.screenStages, plan.stages[state.stage.index]?.key);
    if (!range) return;
    const next = p.screenIndex < range.from ? range.from : p.screenIndex + 1;
    if (next > range.to) return;
    this.send(sessionId, bot, now, {
      v: PROTOCOL_VERSION,
      type: 'student.screen.set',
      index: next,
    });
  }

  private join(sessionId: string, bot: Bot, now: number): void {
    bot.joined = true;
    try {
      const { token } = this.store.loginStudent(sessionId, { ...bot.student, isVirtual: true });
      const socket = new VirtualSocket(() => {
        bot.socket = null;
      });
      const { connection } = this.store.attach(sessionId, socket, 'student', token);
      socket.connection = connection;
      bot.socket = socket;
    } catch (error) {
      this.log.warn({ err: error, sessionId, studentId: bot.student.id }, 'virtual join failed');
      return;
    }
    const pace = this.store.getState(sessionId)?.demoSpeed ?? 1;
    bot.nextAt = now + (bot.profile.paceMs * this.between([0.3, 1])) / pace;
    // A child presses "Начать" and the lesson goes full screen.
    this.send(sessionId, bot, now, {
      v: PROTOCOL_VERSION,
      type: 'student.visibility',
      hidden: false,
      fullscreen: true,
    });
  }

  private send(sessionId: string, bot: Bot, now: number, message: ClientMessage): void {
    if (!bot.socket) return;
    this.store.dispatch(sessionId, bot.socket, {
      kind: 'command',
      role: 'student',
      participantId: bot.student.id,
      message,
      now,
    });
  }

  private between([from, to]: readonly [number, number]): number {
    return from + (to - from) * this.random();
  }

  private ensureTimer(): void {
    if (this.timer || this.sessions.size === 0) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
  }

  private stopTimerIfIdle(): void {
    if (this.sessions.size > 0 || !this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
