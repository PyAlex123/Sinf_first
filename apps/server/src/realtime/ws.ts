import fastifyWebsocket from '@fastify/websocket';
import type { FastifyPluginAsync } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import { z } from 'zod';
import { parseClientMessage, PROTOCOL_VERSION, RoleSchema, type ServerMessage } from '@sinf/shared';
import { ApiHttpError } from '../errors.js';
import type { DemoRelay, DemoSource } from './demo-relay.js';
import type { SessionStore } from './session-store.js';

/**
 * `/ws?session=<id>&role=teacher|student|projector[&participant=<token>]` (ADR-006).
 * Teachers are recognised by the login cookie; students are anonymous participants until S1.7;
 * the projector only listens.
 */

const QuerySchema = z.object({
  session: z.string().min(1),
  role: RoleSchema,
  participant: z.string().min(1).optional(),
});

const HEARTBEAT_MS = 15_000;
/** A lesson message is small; only a screen broadcast frame may be bigger (H14). */
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_FRAME_BYTES = 1024 * 1024;

const DemoQuerySchema = z.object({
  session: z.string().min(1),
  participant: z.string().min(1).optional(),
});

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export const realtimePlugin: FastifyPluginAsync<{ store: SessionStore; demo: DemoRelay }> = async (
  app,
  opts,
) => {
  const { store, demo } = opts;
  // One limit for the plugin: the frames of a broadcast; lesson messages are checked by hand below.
  await app.register(fastifyWebsocket, { options: { maxPayload: MAX_FRAME_BYTES } });

  /**
   * `/ws/demo?session=<id>[&participant=<token>]` — the source of a screen broadcast (H14, ADR-017):
   * the teacher's app on this computer (header `x-host-token`, from 127.0.0.1 only), or the app of
   * the child whose screen is being shown (their lesson token). It sends binary frames and hears
   * "keyframe" and "stop".
   */
  app.get('/ws/demo', { websocket: true }, (socket: WebSocket, request) => {
    const query = DemoQuerySchema.safeParse(request.query);
    if (!query.success) {
      socket.close(4000, 'bad_request');
      return;
    }
    const sessionId = query.data.session;
    let sourceId: string | null = null;
    const token = request.headers['x-host-token'];
    if (
      app.ctx.config.hostToken &&
      typeof token === 'string' &&
      token === app.ctx.config.hostToken &&
      LOOPBACK.has(request.socket.remoteAddress ?? '')
    ) {
      sourceId = 'teacher';
    } else if (query.data.participant) {
      sourceId = store.participantByToken(sessionId, query.data.participant) ?? null;
    }
    if (!sourceId || !demo.canSource(sessionId, sourceId)) {
      socket.close(4001, 'not_the_source');
      return;
    }
    const source: DemoSource = {
      tell: (message) => {
        if (socket.readyState === socket.OPEN) socket.send(message);
      },
      close: () => socket.close(1000, 'stop'),
    };
    demo.attachSource(sessionId, sourceId, source);
    request.log.info({ sessionId, sourceId }, 'screen broadcast source connected');
    socket.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const bytes = Array.isArray(data)
        ? Buffer.concat(data)
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : data;
      const dropped = demo.frame(sessionId, source, bytes);
      if (dropped && dropped !== 'too fast')
        request.log.debug({ dropped }, 'broadcast frame dropped');
    });
    socket.on('close', () => demo.detachSource(sessionId, source));
    socket.on('error', (error) => request.log.warn({ err: error }, 'demo ws error'));
  });

  app.get('/ws', { websocket: true }, (socket: WebSocket, request) => {
    const query = QuerySchema.safeParse(request.query);
    if (!query.success) {
      closeWithError(socket, 'bad_request', 'session and role are required');
      return;
    }
    const { session: sessionId, role } = query.data;
    if (role === 'teacher' && !request.teacher) {
      closeWithError(socket, 'unauthorized', 'Teacher login required');
      return;
    }
    const state = store.getState(sessionId);
    if (!state) {
      closeWithError(socket, 'not_found', 'Session not found or already ended');
      return;
    }
    let attached: ReturnType<typeof store.attach>;
    try {
      attached = store.attach(sessionId, socket, role, query.data.participant ?? null);
    } catch (error) {
      const code = error instanceof ApiHttpError ? error.code : 'error';
      closeWithError(socket, code, error instanceof Error ? error.message : 'Cannot join');
      return;
    }
    const { connection, participantToken } = attached;
    const current = store.getState(sessionId) ?? state;
    send(socket, {
      v: PROTOCOL_VERSION,
      type: 'state.snapshot',
      state: current,
      serverNow: Date.now(),
      you: { role, participantId: connection.participantId, participantToken },
    });

    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('message', (data, isBinary) => {
      // A lesson socket carries small JSON only; binary and oversized messages are not ours.
      const text = isBinary ? '' : rawDataToString(data);
      if (isBinary || text.length > MAX_MESSAGE_BYTES) {
        socket.close(1009, 'too_big');
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text) as unknown;
      } catch {
        send(socket, { v: PROTOCOL_VERSION, type: 'error', code: 'bad_json', message: 'Not JSON' });
        return;
      }
      const message = parseClientMessage(raw);
      if (!message) {
        request.log.debug({ raw }, 'ignored unknown ws message');
        return;
      }
      store.dispatch(sessionId, socket, {
        kind: 'command',
        role,
        participantId: connection.participantId,
        message,
        now: Date.now(),
      });
    });
    socket.on('close', () => store.detach(sessionId, socket));
    socket.on('error', (error) => request.log.warn({ err: error }, 'ws error'));
  });

  // Heartbeat: drop connections that stopped answering pings.
  const heartbeat = setInterval(() => {
    for (const id of store.liveSessionIds()) {
      for (const [socket, connection] of store.sockets(id)) {
        if (!connection.alive) {
          socket.terminate();
          continue;
        }
        connection.alive = false;
        socket.ping();
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  app.addHook('onClose', (_instance, done) => {
    clearInterval(heartbeat);
    store.flush();
    done();
  });
};

/** Text of an incoming frame (`ws` hands over a Buffer, an ArrayBuffer or a list of Buffers). */
export function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function closeWithError(socket: WebSocket, code: string, message: string): void {
  send(socket, { v: PROTOCOL_VERSION, type: 'error', code, message });
  socket.close(4000, code);
}
