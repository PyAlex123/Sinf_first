import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type LockTargets,
  type Participant,
  type Role,
  type ServerMessage,
  type SessionState,
} from './protocol.js';

/**
 * Session engine, pure part (ADR-006): `reduce(state, event)` returns the next state, messages to broadcast to the
 * room, replies for the sender and activity records to store. No timers or I/O here; the server runs it, and later
 * the Class Hub will. Stage timing is added in S1.8.
 */

export type SessionEvent =
  | {
      kind: 'participant.join';
      participantId: string;
      number: number;
      studentId: string | null;
      now: number;
    }
  | { kind: 'participant.leave'; participantId: string; now: number }
  | {
      kind: 'command';
      role: Role;
      /** Participant sending the command (students); null for teacher and projector. */
      participantId: string | null;
      message: ClientMessage;
      now: number;
    };

/** Something worth writing to `activity_events`. */
export interface ActivityRecord {
  type:
    | 'join'
    | 'leave'
    | 'hand_raise'
    | 'tab_hidden'
    | 'fullscreen_exit'
    | 'screen_done'
    | 'lock'
    | 'unlock'
    | 'mode'
    | 'screen'
    | 'session_end';
  participantId: string | null;
  data?: Record<string, unknown>;
}

export interface ReduceResult {
  state: SessionState;
  broadcast: ServerMessage[];
  reply: ServerMessage[];
  activity: ActivityRecord[];
}

export interface NewSessionInput {
  id: string;
  lessonId: string;
  classId: string;
  screenCount: number;
}

export function createSessionState(input: NewSessionInput): SessionState {
  return {
    id: input.id,
    lessonId: input.lessonId,
    classId: input.classId,
    status: 'active',
    mode: 'presentation',
    screenIndex: 0,
    screenCount: input.screenCount,
    lock: { all: null, byParticipant: {} },
    participants: {},
  };
}

const v = PROTOCOL_VERSION;

export function reduce(state: SessionState, event: SessionEvent): ReduceResult {
  const result: ReduceResult = { state, broadcast: [], reply: [], activity: [] };
  if (state.status === 'ended') {
    if (event.kind === 'command') {
      result.reply.push({ v, type: 'error', code: 'session_ended', message: 'Session has ended' });
    }
    return result;
  }
  switch (event.kind) {
    case 'participant.join':
      return join(result, event);
    case 'participant.leave':
      return leave(result, event);
    case 'command':
      return command(result, event);
  }
}

function join(
  r: ReduceResult,
  e: Extract<SessionEvent, { kind: 'participant.join' }>,
): ReduceResult {
  const existing = r.state.participants[e.participantId];
  const participant: Participant = existing
    ? { ...existing, online: true, lastSeenAt: e.now }
    : {
        id: e.participantId,
        number: e.number,
        studentId: e.studentId,
        online: true,
        screenIndex: r.state.mode === 'presentation' ? r.state.screenIndex : 0,
        stars: 0,
        doneScreens: [],
        hand: false,
        hidden: false,
        fullscreen: false,
        lastSeenAt: e.now,
      };
  return updateParticipant(r, participant, { type: 'join', participantId: participant.id });
}

function leave(
  r: ReduceResult,
  e: Extract<SessionEvent, { kind: 'participant.leave' }>,
): ReduceResult {
  const existing = r.state.participants[e.participantId];
  if (!existing || !existing.online) {
    return r;
  }
  return updateParticipant(
    r,
    { ...existing, online: false, hand: false, lastSeenAt: e.now },
    { type: 'leave', participantId: existing.id },
  );
}

function command(r: ReduceResult, e: Extract<SessionEvent, { kind: 'command' }>): ReduceResult {
  const m = e.message;
  if (m.type === 'ping') {
    r.reply.push({ v, type: 'pong', serverNow: e.now });
    return r;
  }
  const forTeacher = m.type.startsWith('teacher.');
  if (forTeacher && e.role !== 'teacher') {
    r.reply.push({
      v,
      type: 'error',
      code: 'forbidden',
      message: `${m.type} is a teacher command`,
    });
    return r;
  }
  if (!forTeacher && e.role !== 'student') {
    r.reply.push({
      v,
      type: 'error',
      code: 'forbidden',
      message: `${m.type} is a student command`,
    });
    return r;
  }
  switch (m.type) {
    case 'teacher.screen.set': {
      const index = clampScreen(r.state, m.index);
      if (index === r.state.screenIndex) return r;
      r.state = { ...r.state, screenIndex: index };
      r.broadcast.push({ v, type: 'screen.changed', index });
      r.activity.push({ type: 'screen', participantId: null, data: { index } });
      return r;
    }
    case 'teacher.mode.set': {
      if (m.mode === r.state.mode) return r;
      r.state = { ...r.state, mode: m.mode };
      r.broadcast.push({ v, type: 'mode.changed', mode: m.mode });
      r.activity.push({ type: 'mode', participantId: null, data: { mode: m.mode } });
      return r;
    }
    case 'teacher.lock':
      return setLock(r, m.targets, m.text ?? '');
    case 'teacher.unlock':
      return setLock(r, m.targets, null);
    case 'teacher.session.end':
      r.state = { ...r.state, status: 'ended' };
      r.broadcast.push({ v, type: 'session.ended' });
      r.activity.push({ type: 'session_end', participantId: null });
      return r;
    case 'student.screen.set':
    case 'student.screen.done':
    case 'student.hand':
    case 'student.visibility':
      return studentCommand(r, e, m);
  }
}

function studentCommand(
  r: ReduceResult,
  e: Extract<SessionEvent, { kind: 'command' }>,
  m: Exclude<ClientMessage, { type: `teacher.${string}` | 'ping' }>,
): ReduceResult {
  const p = e.participantId ? r.state.participants[e.participantId] : undefined;
  if (!p) {
    r.reply.push({
      v,
      type: 'error',
      code: 'unknown_participant',
      message: 'Join the session first',
    });
    return r;
  }
  switch (m.type) {
    case 'student.screen.set': {
      const index = clampScreen(r.state, m.index);
      if (index === p.screenIndex) return r;
      return updateParticipant(r, { ...p, screenIndex: index, lastSeenAt: e.now });
    }
    case 'student.screen.done': {
      const index = clampScreen(r.state, m.index);
      if (p.doneScreens.includes(index)) return r;
      return updateParticipant(
        r,
        {
          ...p,
          stars: p.stars + m.stars,
          doneScreens: [...p.doneScreens, index],
          lastSeenAt: e.now,
        },
        { type: 'screen_done', participantId: p.id, data: { index, stars: m.stars } },
      );
    }
    case 'student.hand': {
      if (m.up === p.hand) return r;
      return updateParticipant(
        r,
        { ...p, hand: m.up, lastSeenAt: e.now },
        m.up ? { type: 'hand_raise', participantId: p.id } : undefined,
      );
    }
    case 'student.visibility': {
      if (m.hidden === p.hidden && m.fullscreen === p.fullscreen) return r;
      const activity: ActivityRecord | undefined =
        m.hidden && !p.hidden
          ? { type: 'tab_hidden', participantId: p.id }
          : !m.fullscreen && p.fullscreen
            ? { type: 'fullscreen_exit', participantId: p.id }
            : undefined;
      return updateParticipant(
        r,
        { ...p, hidden: m.hidden, fullscreen: m.fullscreen, lastSeenAt: e.now },
        activity,
      );
    }
  }
}

function setLock(r: ReduceResult, targets: LockTargets, text: string | null): ReduceResult {
  const lock = { all: r.state.lock.all, byParticipant: { ...r.state.lock.byParticipant } };
  if (targets === 'all') {
    lock.all = text === null ? null : { text };
    if (text === null) lock.byParticipant = {};
  } else {
    for (const participantId of targets) {
      if (text === null) delete lock.byParticipant[participantId];
      else lock.byParticipant[participantId] = { text };
    }
  }
  r.state = { ...r.state, lock };
  r.broadcast.push({ v, type: 'lock.changed', lock });
  r.activity.push({
    type: text === null ? 'unlock' : 'lock',
    participantId: null,
    data: { targets, ...(text === null ? {} : { text }) },
  });
  return r;
}

function updateParticipant(
  r: ReduceResult,
  participant: Participant,
  activity?: ActivityRecord,
): ReduceResult {
  r.state = {
    ...r.state,
    participants: { ...r.state.participants, [participant.id]: participant },
  };
  r.broadcast.push({ v, type: 'participant.updated', participant });
  if (activity) r.activity.push(activity);
  return r;
}

function clampScreen(state: SessionState, index: number): number {
  return Math.max(0, Math.min(state.screenCount - 1, index));
}

/** Is this participant's screen locked, and with what text? */
export function lockFor(state: SessionState, participantId: string): { text: string } | null {
  return state.lock.byParticipant[participantId] ?? state.lock.all;
}

/** Next free participant number ("Student N"). */
export function nextParticipantNumber(state: SessionState): number {
  return Object.values(state.participants).reduce((max, p) => Math.max(max, p.number), 0) + 1;
}
