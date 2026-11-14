import {
  lockFor,
  type Participant,
  type Role,
  type ServerMessage,
  type SessionState,
  type You,
} from '@sinf/shared';
import { SessionSocket, type ConnectionStatus } from '../ws.js';

/**
 * Reactive mirror of the server's session state for one page (teacher panel, student screen, projector).
 * Applies snapshot and delta messages; exposes commands.
 */

export const TOKEN_KEY = (sessionId: string): string => `sinf.participant.${sessionId}`;

/** Token saved by the join page; the student screen reads it to open the socket. */
export function readParticipantToken(sessionId: string): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY(sessionId));
  } catch {
    return null;
  }
}

export function saveParticipantToken(sessionId: string, token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY(sessionId), token);
  } catch {
    // private mode: the student will have to log in again after a reload
  }
}

export class SessionStore {
  state = $state<SessionState | null>(null);
  you = $state<You | null>(null);
  status = $state<ConnectionStatus>('connecting');
  lastError = $state<{ code: string; message: string } | null>(null);
  /** The same student logged in from another device (S1.7). */
  kicked = $state(false);
  private socket: SessionSocket | null = null;

  constructor(
    readonly sessionId: string,
    readonly role: Role,
  ) {}

  connect(): void {
    const token = this.role === 'student' ? readParticipantToken(this.sessionId) : null;
    this.socket = new SessionSocket({
      sessionId: this.sessionId,
      role: this.role,
      participantToken: token,
      onMessage: (m) => this.apply(m),
      onStatus: (s) => {
        this.status = s;
      },
    });
    this.socket.connect();
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }

  get participants(): Participant[] {
    const all = Object.values(this.state?.participants ?? {});
    return all.sort((a, b) => a.number - b.number);
  }

  get me(): Participant | undefined {
    const id = this.you?.participantId;
    return id ? this.state?.participants[id] : undefined;
  }

  /** Lock text for this student, or null when not locked. */
  get myLock(): { text: string } | null {
    const id = this.you?.participantId;
    return this.state && id ? lockFor(this.state, id) : null;
  }

  // ---------- commands

  setScreen(index: number): void {
    if (this.role === 'teacher') {
      // Optimistic: quick repeated presses must count from the new screen, not wait for the echo.
      if (this.state) this.state = { ...this.state, screenIndex: index };
      this.socket?.send({ type: 'teacher.screen.set', index });
    } else {
      this.socket?.send({ type: 'student.screen.set', index });
    }
  }

  setMode(mode: 'presentation' | 'free'): void {
    this.socket?.send({ type: 'teacher.mode.set', mode });
  }

  // ---------- stage controls (S1.8)

  setStage(index: number): void {
    this.socket?.send({ type: 'teacher.stage.set', index });
  }

  skipStage(): void {
    this.socket?.send({ type: 'teacher.stage.skip' });
  }

  backStage(): void {
    this.socket?.send({ type: 'teacher.stage.back' });
  }

  pauseStage(): void {
    this.socket?.send({ type: 'teacher.stage.pause' });
  }

  resumeStage(): void {
    this.socket?.send({ type: 'teacher.stage.resume' });
  }

  extendStage(minutes: number): void {
    this.socket?.send({ type: 'teacher.stage.extend', minutes });
  }

  setDemoSpeed(speed: number): void {
    this.socket?.send({ type: 'teacher.demoSpeed.set', speed });
  }

  /** Server time now, by the offset from the last snapshot or pong. */
  now(): number {
    return Date.now() + (this.socket?.serverOffset ?? 0);
  }

  lock(targets: 'all' | string[], text?: string): void {
    this.socket?.send({ type: 'teacher.lock', targets, ...(text ? { text } : {}) });
  }

  unlock(targets: 'all' | string[]): void {
    this.socket?.send({ type: 'teacher.unlock', targets });
  }

  /** The teacher answered the child and puts their raised hand down. */
  clearHand(participantId: string): void {
    this.socket?.send({ type: 'teacher.hand.clear', participantId });
  }

  end(): void {
    this.socket?.send({ type: 'teacher.session.end' });
  }

  screenDone(index: number, stars: number): void {
    this.socket?.send({ type: 'student.screen.done', index, stars });
  }

  hand(up: boolean): void {
    this.socket?.send({ type: 'student.hand', up });
  }

  visibility(hidden: boolean, fullscreen: boolean): void {
    this.socket?.send({ type: 'student.visibility', hidden, fullscreen });
  }

  // ---------- state updates

  private apply(m: ServerMessage): void {
    switch (m.type) {
      case 'state.snapshot':
        this.state = m.state;
        this.you = m.you;
        if (m.you.participantToken) {
          try {
            sessionStorage.setItem(TOKEN_KEY(this.sessionId), m.you.participantToken);
          } catch {
            // ignore
          }
        }
        return;
      case 'screen.changed':
        if (this.state) this.state = { ...this.state, screenIndex: m.index };
        return;
      case 'mode.changed':
        if (this.state) this.state = { ...this.state, mode: m.mode };
        return;
      case 'stage.changed':
        if (this.state) this.state = { ...this.state, stage: m.stage };
        return;
      case 'demoSpeed.changed':
        if (this.state) this.state = { ...this.state, demoSpeed: m.speed };
        return;
      case 'lock.changed':
        if (this.state) this.state = { ...this.state, lock: m.lock };
        return;
      case 'participant.updated':
        if (this.state) {
          this.state = {
            ...this.state,
            participants: { ...this.state.participants, [m.participant.id]: m.participant },
          };
        }
        return;
      case 'session.ended':
        if (this.state) this.state = { ...this.state, status: 'ended' };
        return;
      case 'session.kicked':
        this.kicked = true;
        return;
      case 'error':
        this.lastError = { code: m.code, message: m.message };
        return;
      case 'pong':
        return;
    }
  }
}
