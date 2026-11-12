import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';
import {
  createSessionState,
  nextParticipantNumber,
  reduce,
  SessionStateSchema,
  type ActivityRecord,
  type Role,
  type ServerMessage,
  type SessionEvent,
  type SessionState,
  type SessionSummary,
} from '@sinf/shared';
import type { ContentStore } from '../content/index.js';
import { schema, type Db } from '../db/index.js';
import { ApiHttpError, notFound } from '../errors.js';

/**
 * Active lesson sessions: state in memory (ADR-006), snapshots in `sessions.state_json`, activity in
 * `activity_events`. One store per server process.
 */

export interface Connection {
  role: Role;
  participantId: string | null;
  alive: boolean;
}

interface LiveSession {
  state: SessionState;
  sockets: Map<WebSocket, Connection>;
  /** participantToken → participantId. Anonymous participants reconnect with their token. */
  tokens: Map<string, string>;
  saveTimer: NodeJS.Timeout | null;
}

/** What is persisted in `state_json` (a type alias, so it is assignable to the column's `Record<string, unknown>`). */
type PersistedState = {
  state: SessionState;
  tokens: Record<string, string>;
};

const SAVE_DEBOUNCE_MS = 2000;

export class SessionStore {
  private readonly live = new Map<string, LiveSession>();

  constructor(
    private readonly db: Db,
    private readonly content: ContentStore,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => number = Date.now,
  ) {}

  /** Starts a session for a class; the previous active session of the class is ended. */
  create(input: { classId: string; lessonId: string; teacherId: string }): SessionSummary {
    const lesson = this.content.getLesson(input.lessonId);
    if (!lesson) throw notFound(`Lesson "${input.lessonId}" not found`);
    const cls = this.db
      .select({ id: schema.classes.id })
      .from(schema.classes)
      .where(eq(schema.classes.id, input.classId))
      .get();
    if (!cls) throw notFound(`Class "${input.classId}" not found`);

    for (const previous of this.activeRows(input.classId)) {
      this.end(previous.id);
    }
    const id = randomUUID();
    const startedAt = new Date(this.now()).toISOString();
    const state = createSessionState({
      id,
      lessonId: lesson.id,
      classId: input.classId,
      screenCount: lesson.screens.length,
    });
    const joinCode = this.freeJoinCode();
    this.db
      .insert(schema.sessions)
      .values({
        id,
        classId: input.classId,
        lessonId: lesson.id,
        teacherId: input.teacherId,
        joinCode,
        status: 'active',
        startedAt,
        demoSpeed: 1,
        stateJson: { state, tokens: {} } satisfies PersistedState,
      })
      .run();
    this.live.set(id, { state, sockets: new Map(), tokens: new Map(), saveTimer: null });
    this.log.info(
      { sessionId: id, lessonId: lesson.id, classId: input.classId },
      'session started',
    );
    return this.summary(id) as SessionSummary;
  }

  /** Session summary from the database (works for ended sessions too). */
  summary(id: string): SessionSummary | undefined {
    const row = this.db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();
    if (!row) return undefined;
    return {
      id: row.id,
      classId: row.classId,
      lessonId: row.lessonId,
      lessonTitle: this.content.getLesson(row.lessonId)?.title ?? row.lessonId,
      joinCode: row.joinCode,
      status: row.status,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    };
  }

  /** Current state of an active session, loading it from the snapshot after a server restart. */
  getState(id: string): SessionState | undefined {
    return this.get(id)?.state;
  }

  activeSessionOfClass(classId: string): SessionSummary | undefined {
    const row = this.activeRows(classId)[0];
    return row ? this.summary(row.id) : undefined;
  }

  end(id: string): void {
    const session = this.get(id);
    if (!session) return;
    const result = reduce(session.state, {
      kind: 'command',
      role: 'teacher',
      participantId: null,
      message: { v: 1, type: 'teacher.session.end' },
      now: this.now(),
    });
    this.apply(id, session, result, null);
  }

  /** Registers a socket; returns its connection record. Students get a participant (new or by token). */
  attach(
    id: string,
    socket: WebSocket,
    role: Role,
    participantToken: string | null,
  ): { connection: Connection; participantToken: string | null } {
    const session = this.get(id);
    if (!session) throw notFound('Session not found');
    if (session.state.status !== 'active') {
      throw new ApiHttpError(410, 'session_ended', 'Session has ended');
    }
    let participantId: string | null = null;
    let token: string | null = null;
    if (role === 'student') {
      const known = participantToken ? session.tokens.get(participantToken) : undefined;
      if (known && participantToken) {
        participantId = known;
        token = participantToken;
      } else {
        participantId = randomUUID();
        token = randomBytes(24).toString('base64url');
        session.tokens.set(token, participantId);
      }
      const existing = session.state.participants[participantId];
      const result = reduce(session.state, {
        kind: 'participant.join',
        participantId,
        number: existing?.number ?? nextParticipantNumber(session.state),
        studentId: null,
        now: this.now(),
      });
      this.apply(id, session, result, null);
    }
    const connection: Connection = { role, participantId, alive: true };
    session.sockets.set(socket, connection);
    return { connection, participantToken: token };
  }

  detach(id: string, socket: WebSocket): void {
    const session = this.live.get(id);
    if (!session) return;
    const connection = session.sockets.get(socket);
    session.sockets.delete(socket);
    if (!connection?.participantId) return;
    // Still connected from another tab? Then the participant stays online.
    for (const other of session.sockets.values()) {
      if (other.participantId === connection.participantId) return;
    }
    const result = reduce(session.state, {
      kind: 'participant.leave',
      participantId: connection.participantId,
      now: this.now(),
    });
    this.apply(id, session, result, null);
  }

  /** Applies a client message and sends replies to the sender, broadcasts to the room. */
  dispatch(id: string, socket: WebSocket, message: SessionEvent & { kind: 'command' }): void {
    const session = this.live.get(id);
    if (!session) return;
    const result = reduce(session.state, message);
    this.apply(id, session, result, socket);
  }

  connections(id: string): Connection[] {
    return [...(this.live.get(id)?.sockets.values() ?? [])];
  }

  /** Sockets of a session (for heartbeat and shutdown). */
  sockets(id: string): Map<WebSocket, Connection> {
    return this.live.get(id)?.sockets ?? new Map<WebSocket, Connection>();
  }

  liveSessionIds(): string[] {
    return [...this.live.keys()];
  }

  /** Flushes pending snapshots (shutdown). */
  flush(): void {
    for (const [id, session] of this.live) {
      if (session.saveTimer) {
        clearTimeout(session.saveTimer);
        session.saveTimer = null;
        this.save(id, session);
      }
    }
  }

  // ---------- internals

  private get(id: string): LiveSession | undefined {
    const cached = this.live.get(id);
    if (cached) return cached;
    const row = this.db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();
    if (!row || row.status !== 'active' || !row.stateJson) return undefined;
    const persisted = row.stateJson as unknown as PersistedState;
    const parsed = SessionStateSchema.safeParse(persisted.state);
    if (!parsed.success) {
      this.log.error({ sessionId: id, issues: parsed.error.issues }, 'bad session snapshot');
      return undefined;
    }
    // After a restart nobody is connected yet.
    const participants = Object.fromEntries(
      Object.entries(parsed.data.participants).map(([key, p]) => [
        key,
        { ...p, online: false, hand: false },
      ]),
    );
    const session: LiveSession = {
      state: { ...parsed.data, participants },
      sockets: new Map(),
      tokens: new Map(Object.entries(persisted.tokens ?? {})),
      saveTimer: null,
    };
    this.live.set(id, session);
    this.log.info({ sessionId: id }, 'session restored from snapshot');
    return session;
  }

  private apply(
    id: string,
    session: LiveSession,
    result: ReturnType<typeof reduce>,
    sender: WebSocket | null,
  ): void {
    session.state = result.state;
    if (sender) {
      for (const message of result.reply) this.send(sender, message);
    }
    if (result.broadcast.length > 0) {
      for (const socket of session.sockets.keys()) {
        for (const message of result.broadcast) this.send(socket, message);
      }
    }
    this.recordActivity(id, result.activity);
    if (result.state.status === 'ended') {
      this.finish(id, session);
    } else if (result.broadcast.length > 0 || result.activity.length > 0) {
      this.scheduleSave(id, session);
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  private recordActivity(id: string, records: ActivityRecord[]): void {
    if (records.length === 0) return;
    const at = new Date(this.now()).toISOString();
    this.db
      .insert(schema.activityEvents)
      .values(
        records.map((r) => ({
          id: randomUUID(),
          sessionId: id,
          studentId: null,
          type: r.type,
          at,
          data: {
            ...(r.data ?? {}),
            ...(r.participantId ? { participantId: r.participantId } : {}),
          },
        })),
      )
      .run();
  }

  private scheduleSave(id: string, session: LiveSession): void {
    if (session.saveTimer) return;
    session.saveTimer = setTimeout(() => {
      session.saveTimer = null;
      this.save(id, session);
    }, SAVE_DEBOUNCE_MS);
    session.saveTimer.unref();
  }

  private save(id: string, session: LiveSession): void {
    const persisted: PersistedState = {
      state: session.state,
      tokens: Object.fromEntries(session.tokens),
    };
    this.db
      .update(schema.sessions)
      .set({ stateJson: persisted })
      .where(eq(schema.sessions.id, id))
      .run();
  }

  private finish(id: string, session: LiveSession): void {
    if (session.saveTimer) {
      clearTimeout(session.saveTimer);
      session.saveTimer = null;
    }
    this.db
      .update(schema.sessions)
      .set({
        status: 'ended',
        endedAt: new Date(this.now()).toISOString(),
        stateJson: { state: session.state, tokens: {} } satisfies PersistedState,
      })
      .where(eq(schema.sessions.id, id))
      .run();
    for (const socket of session.sockets.keys()) {
      socket.close(1000, 'session ended');
    }
    session.sockets.clear();
    this.live.delete(id);
    this.log.info({ sessionId: id }, 'session ended');
  }

  private activeRows(classId: string): { id: string }[] {
    return this.db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.classId, classId), eq(schema.sessions.status, 'active')))
      .all();
  }

  private freeJoinCode(): string {
    const used = new Set(
      this.db
        .select({ joinCode: schema.sessions.joinCode })
        .from(schema.sessions)
        .where(eq(schema.sessions.status, 'active'))
        .all()
        .map((r) => r.joinCode),
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      if (!used.has(code)) return code;
    }
    throw new Error('No free join codes');
  }
}
