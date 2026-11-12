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

const TOKEN_KEY = (sessionId: string): string => `sinf.participant.${sessionId}`;

export class SessionStore {
  state = $state<SessionState | null>(null);
  you = $state<You | null>(null);
  status = $state<ConnectionStatus>('connecting');
  lastError = $state<{ code: string; message: string } | null>(null);
  private socket: SessionSocket | null = null;

  constructor(
    readonly sessionId: string,
    readonly role: Role,
  ) {}

  connect(): void {
    let token: string | null = null;
    if (this.role === 'student') {
      try {
        token = sessionStorage.getItem(TOKEN_KEY(this.sessionId));
      } catch {
        token = null;
      }
    }
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
    this.socket?.send(
      this.role === 'teacher'
        ? { type: 'teacher.screen.set', index }
        : { type: 'student.screen.set', index },
    );
  }

  setMode(mode: 'presentation' | 'free'): void {
    this.socket?.send({ type: 'teacher.mode.set', mode });
  }

  lock(targets: 'all' | string[], text?: string): void {
    this.socket?.send({ type: 'teacher.lock', targets, ...(text ? { text } : {}) });
  }

  unlock(targets: 'all' | string[]): void {
    this.socket?.send({ type: 'teacher.unlock', targets });
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
      case 'error':
        this.lastError = { code: m.code, message: m.message };
        return;
      case 'pong':
        return;
    }
  }
}
