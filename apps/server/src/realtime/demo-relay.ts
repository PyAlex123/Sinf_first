import { parseFrame, type DemoState } from '@sinf/shared';
import type { RoomSocket, SessionStore } from './session-store.js';

/**
 * The lesson server's half of a screen broadcast (CLAUDE.md §4.4; stage 3, H14; ADR-017).
 *
 * One source per lesson — the teacher's app, or the app of the child whose screen is shown — sends
 * binary frames on `/ws/demo`. The server checks each frame's header, stamps the broadcast's epoch
 * into it and passes the bytes on, unchanged otherwise, to every viewer's lesson socket.
 *
 * Thirty viewers on a slow network do not all keep up. A viewer with too much waiting in its socket
 * skips the next frames and waits for a whole picture (a keyframe); the source is asked for one at
 * most once a second, so one slow computer cannot make the source send whole pictures all the time.
 */

/** A viewer with more than this waiting is behind: it skips frames until the next whole picture. */
export const LAG_BYTES = 1536 * 1024;
/** Frames faster than this are not passed on (the source paces itself at 2–5 a second). */
const MIN_FRAME_INTERVAL_MS = 120;
const KEYFRAME_REQUEST_INTERVAL_MS = 1000;

export interface DemoSource {
  /** Sends a short instruction to the source app: "keyframe" or "stop". */
  tell(message: 'keyframe' | 'stop'): void;
  close(): void;
}

interface Relay {
  source: DemoSource | null;
  /** Who the current source is: "teacher" or a participant id. */
  sourceId: string | null;
  lastFrameAt: number;
  lastKeyframeRequest: number;
  /** Viewers that skipped a frame and wait for a whole picture. */
  waiting: Set<RoomSocket>;
}

export class DemoRelay {
  private readonly relays = new Map<string, Relay>();

  constructor(
    private readonly store: SessionStore,
    private readonly now: () => number = Date.now,
  ) {
    store.onDemoChanged = (sessionId, demo) => this.demoChanged(sessionId, demo);
    store.onAttached = (sessionId, socket) => this.viewerJoined(sessionId, socket);
  }

  private relay(sessionId: string): Relay {
    let r = this.relays.get(sessionId);
    if (!r) {
      r = {
        source: null,
        sourceId: null,
        lastFrameAt: 0,
        lastKeyframeRequest: 0,
        waiting: new Set(),
      };
      this.relays.set(sessionId, r);
    }
    return r;
  }

  /**
   * May this connection be the source? The teacher's app (checked by the caller with the host token)
   * when the teacher's screen is shown; a child's app only while their screen is the one shown.
   */
  canSource(sessionId: string, sourceId: string): boolean {
    const demo = this.store.getState(sessionId)?.demo;
    return !!demo && demo.source === sourceId;
  }

  attachSource(sessionId: string, sourceId: string, source: DemoSource): void {
    const r = this.relay(sessionId);
    if (r.source && r.source !== source) r.source.close();
    r.source = source;
    r.sourceId = sourceId;
    r.waiting.clear();
    // Everybody needs a whole picture to begin with.
    r.lastKeyframeRequest = this.now();
    source.tell('keyframe');
  }

  detachSource(sessionId: string, source: DemoSource): void {
    const r = this.relays.get(sessionId);
    if (r?.source === source) {
      r.source = null;
      r.sourceId = null;
    }
  }

  /** A frame from the source. Returns why it was dropped, for the log and the tests; null when sent. */
  frame(sessionId: string, source: DemoSource, data: Uint8Array): string | null {
    const r = this.relays.get(sessionId);
    const demo = this.store.getState(sessionId)?.demo;
    if (!r || r.source !== source || !demo || demo.source !== r.sourceId) return 'not the source';
    const header = parseFrame(data);
    if (!header) return 'bad frame';
    const now = this.now();
    if (!header.keyframe && now - r.lastFrameAt < MIN_FRAME_INTERVAL_MS) return 'too fast';
    r.lastFrameAt = now;

    // The broadcast's number goes into the frame: a page drops frames of a broadcast that is over.
    const frame = new Uint8Array(data);
    new DataView(frame.buffer, frame.byteOffset, frame.byteLength).setUint32(6, demo.epoch, true);

    let behind = false;
    for (const [socket, connection] of this.store.sockets(sessionId)) {
      if (socket.readyState !== socket.OPEN) continue;
      // Nobody needs their own screen back: not the teacher, not the child who is shown.
      if (
        demo.source === 'teacher'
          ? connection.role === 'teacher'
          : connection.participantId === demo.source
      ) {
        continue;
      }
      if (r.waiting.has(socket)) {
        if (!header.keyframe) continue;
        r.waiting.delete(socket);
      }
      if ((socket.bufferedAmount ?? 0) > LAG_BYTES) {
        r.waiting.add(socket);
        behind = true;
        continue;
      }
      socket.send(frame);
    }
    if (behind || r.waiting.size > 0) this.askKeyframe(r);
    return null;
  }

  private askKeyframe(r: Relay): void {
    const now = this.now();
    if (!r.source || now - r.lastKeyframeRequest < KEYFRAME_REQUEST_INTERVAL_MS) return;
    r.lastKeyframeRequest = now;
    r.source.tell('keyframe');
  }

  private viewerJoined(sessionId: string, socket: RoomSocket): void {
    const r = this.relays.get(sessionId);
    if (!r?.source) return;
    r.waiting.add(socket);
    this.askKeyframe(r);
  }

  private demoChanged(sessionId: string, demo: DemoState | null): void {
    const r = this.relays.get(sessionId);
    if (!r?.source) return;
    // Another source, or none: the old one stops filming.
    if (!demo || demo.source !== r.sourceId) {
      r.source.tell('stop');
      r.source.close();
      r.source = null;
      r.sourceId = null;
      r.waiting.clear();
    } else {
      // The same source, a new broadcast (another mode): start over with a whole picture.
      r.waiting.clear();
      r.lastKeyframeRequest = this.now();
      r.source.tell('keyframe');
    }
  }

  /** The lesson is over: nothing of it stays. */
  end(sessionId: string): void {
    const r = this.relays.get(sessionId);
    r?.source?.tell('stop');
    r?.source?.close();
    this.relays.delete(sessionId);
  }
}
