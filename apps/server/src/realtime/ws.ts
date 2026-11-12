import fastifyWebsocket from '@fastify/websocket';
import type { FastifyPluginAsync } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import { z } from 'zod';
import { parseClientMessage, PROTOCOL_VERSION, RoleSchema, type ServerMessage } from '@sinf/shared';
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
const MAX_PAYLOAD_BYTES = 64 * 1024;

export const realtimePlugin: FastifyPluginAsync<{ store: SessionStore }> = async (app, opts) => {
  const { store } = opts;
  await app.register(fastifyWebsocket, { options: { maxPayload: MAX_PAYLOAD_BYTES } });

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
    const { connection, participantToken } = store.attach(
      sessionId,
      socket,
      role,
      query.data.participant ?? null,
    );
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
    socket.on('message', (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(rawDataToString(data)) as unknown;
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
