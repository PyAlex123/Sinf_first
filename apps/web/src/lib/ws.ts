import {
  parseServerMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type Role,
  type ServerMessage,
} from '@sinf/shared';

/**
 * WebSocket client for a lesson session (ADR-006): reconnects with backoff, keeps the server time offset,
 * delivers parsed messages to one listener.
 */

export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'ended';

/** A client message without `v` (added on send). Distributes over the union, unlike a plain `Omit`. */
export type OutgoingMessage = {
  [K in ClientMessage['type']]: Omit<Extract<ClientMessage, { type: K }>, 'v'>;
}[ClientMessage['type']];

export interface SessionSocketOptions {
  sessionId: string;
  role: Role;
  /** Anonymous student token from a previous connection, if any. */
  participantToken?: string | null;
  onMessage: (message: ServerMessage) => void;
  onStatus?: (status: ConnectionStatus) => void;
}

const PING_INTERVAL_MS = 20_000;
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

export class SessionSocket {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private closedByUser = false;
  private ended = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** `serverNow - Date.now()` from the last snapshot or pong. */
  serverOffset = 0;
  participantToken: string | null;

  constructor(private readonly options: SessionSocketOptions) {
    this.participantToken = options.participantToken ?? null;
  }

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  close(): void {
    this.closedByUser = true;
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
  }

  send(message: OutgoingMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ v: PROTOCOL_VERSION, ...message }));
    }
  }

  /** Current server time, by the last known offset. */
  now(): number {
    return Date.now() + this.serverOffset;
  }

  private url(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const params = new URLSearchParams({
      session: this.options.sessionId,
      role: this.options.role,
    });
    if (this.participantToken) params.set('participant', this.participantToken);
    return `${proto}://${location.host}/ws?${params.toString()}`;
  }

  private open(): void {
    if (this.ended) return;
    this.options.onStatus?.('connecting');
    const socket = new WebSocket(this.url());
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.options.onStatus?.('open');
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), PING_INTERVAL_MS);
    };
    socket.onmessage = (event) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const message = parseServerMessage(raw);
      if (!message) return;
      if (message.type === 'pong' || message.type === 'state.snapshot') {
        this.serverOffset = message.serverNow - Date.now();
      }
      if (message.type === 'state.snapshot' && message.you.participantToken) {
        this.participantToken = message.you.participantToken;
      }
      if (message.type === 'session.ended') {
        this.ended = true;
        this.options.onStatus?.('ended');
      }
      if (
        message.type === 'error' &&
        (message.code === 'not_found' || message.code === 'unauthorized')
      ) {
        this.ended = true;
        this.options.onStatus?.('ended');
      }
      this.options.onMessage(message);
    };
    socket.onclose = () => {
      this.clearTimers();
      if (this.socket === socket) this.socket = null;
      if (this.closedByUser || this.ended) {
        if (!this.ended) this.options.onStatus?.('closed');
        return;
      }
      this.options.onStatus?.('closed');
      const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 8000;
      this.attempt++;
      this.reconnectTimer = setTimeout(() => this.open(), delay);
    };
    socket.onerror = () => {
      // onclose follows and schedules the reconnect
    };
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
  }
}
