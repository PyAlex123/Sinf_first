import { describe, expect, it } from 'vitest';
import {
  createSessionState,
  lockFor,
  nextParticipantNumber,
  reduce,
  type ClientMessage,
  type SessionState,
} from '../src/index.js';

const base = (): SessionState =>
  createSessionState({
    id: 's1',
    lessonId: 'g10',
    classId: 'class-1a',
    screenCount: 5,
    now: 1000,
  });

const teacher = (state: SessionState, message: ClientMessage, now = 1000) =>
  reduce(state, { kind: 'command', role: 'teacher', participantId: null, message, now });

const student = (state: SessionState, participantId: string, message: ClientMessage, now = 1000) =>
  reduce(state, { kind: 'command', role: 'student', participantId, message, now });

const joined = (state: SessionState, participantId: string, number: number) =>
  reduce(state, {
    kind: 'participant.join',
    participantId,
    number,
    studentId: null,
    name: null,
    now: 1,
  });

describe('session reducer', () => {
  it('starts in presentation mode on the first screen', () => {
    const s = base();
    expect(s.mode).toBe('presentation');
    expect(s.screenIndex).toBe(0);
    expect(nextParticipantNumber(s)).toBe(1);
  });

  it('adds participants, numbers them and marks them offline on leave', () => {
    let r = joined(base(), 'p1', 1);
    r = joined(r.state, 'p2', nextParticipantNumber(r.state));
    expect(Object.keys(r.state.participants)).toEqual(['p1', 'p2']);
    expect(r.state.participants['p2']?.number).toBe(2);
    expect(r.broadcast).toEqual([
      expect.objectContaining({ type: 'participant.updated' }) as unknown,
    ]);
    expect(r.activity).toEqual([{ type: 'join', participantId: 'p2' }]);

    r = reduce(r.state, { kind: 'participant.leave', participantId: 'p1', now: 5 });
    expect(r.state.participants['p1']).toMatchObject({ online: false, lastSeenAt: 5 });
    // leaving twice changes nothing
    expect(
      reduce(r.state, { kind: 'participant.leave', participantId: 'p1', now: 6 }).broadcast,
    ).toEqual([]);
    // rejoining keeps the number
    r = joined(r.state, 'p1', 99);
    expect(r.state.participants['p1']).toMatchObject({ online: true, number: 1 });
  });

  it('lets the teacher change the screen within bounds and broadcasts the change', () => {
    let r = teacher(base(), { v: 1, type: 'teacher.screen.set', index: 3 });
    expect(r.state.screenIndex).toBe(3);
    expect(r.broadcast).toEqual([{ v: 1, type: 'screen.changed', index: 3 }]);
    r = teacher(r.state, { v: 1, type: 'teacher.screen.set', index: 99 });
    expect(r.state.screenIndex).toBe(4);
    expect(teacher(r.state, { v: 1, type: 'teacher.screen.set', index: 4 }).broadcast).toEqual([]);
  });

  it('switches mode', () => {
    const r = teacher(base(), { v: 1, type: 'teacher.mode.set', mode: 'free' });
    expect(r.state.mode).toBe('free');
    expect(r.broadcast).toEqual([{ v: 1, type: 'mode.changed', mode: 'free' }]);
  });

  it('locks everybody, some participants, and unlocks', () => {
    let r = joined(base(), 'p1', 1);
    r = joined(r.state, 'p2', 2);
    r = teacher(r.state, { v: 1, type: 'teacher.lock', targets: ['p2'], text: 'Смотри на доску' });
    expect(lockFor(r.state, 'p1')).toBeNull();
    expect(lockFor(r.state, 'p2')).toEqual({ text: 'Смотри на доску' });
    r = teacher(r.state, { v: 1, type: 'teacher.lock', targets: 'all' });
    expect(lockFor(r.state, 'p1')).toEqual({ text: '' });
    expect(r.broadcast.at(-1)?.type).toBe('lock.changed');
    r = teacher(r.state, { v: 1, type: 'teacher.unlock', targets: ['p2'] });
    expect(lockFor(r.state, 'p2')).toEqual({ text: '' }); // still locked by "all"
    r = teacher(r.state, { v: 1, type: 'teacher.unlock', targets: 'all' });
    expect(r.state.lock).toEqual({ all: null, byParticipant: {} });
    expect(r.activity.map((a) => a.type)).toEqual(['unlock']);
  });

  it('counts stars once per screen and tracks hand and visibility', () => {
    let r = joined(base(), 'p1', 1);
    r = student(r.state, 'p1', { v: 1, type: 'student.screen.done', index: 2, stars: 2 });
    r = student(r.state, 'p1', { v: 1, type: 'student.screen.done', index: 2, stars: 3 });
    expect(r.state.participants['p1']).toMatchObject({ stars: 2, doneScreens: [2] });
    expect(r.broadcast).toEqual([]);

    r = student(r.state, 'p1', { v: 1, type: 'student.hand', up: true });
    expect(r.state.participants['p1']?.hand).toBe(true);
    expect(r.activity).toEqual([{ type: 'hand_raise', participantId: 'p1' }]);

    r = student(r.state, 'p1', {
      v: 1,
      type: 'student.visibility',
      hidden: true,
      fullscreen: false,
    });
    expect(r.activity).toEqual([{ type: 'tab_hidden', participantId: 'p1' }]);
    r = student(r.state, 'p1', { v: 1, type: 'student.screen.set', index: 7 });
    expect(r.state.participants['p1']?.screenIndex).toBe(4);
  });

  it('rejects commands from the wrong role or an unknown participant', () => {
    const asStudent = student(base(), 'ghost', { v: 1, type: 'teacher.screen.set', index: 1 });
    expect(asStudent.reply).toEqual([
      expect.objectContaining({ type: 'error', code: 'forbidden' }),
    ]);
    const unknown = student(base(), 'ghost', { v: 1, type: 'student.hand', up: true });
    expect(unknown.reply[0]).toMatchObject({ code: 'unknown_participant' });
    const projector = reduce(base(), {
      kind: 'command',
      role: 'projector',
      participantId: null,
      message: { v: 1, type: 'student.hand', up: true },
      now: 1,
    });
    expect(projector.reply[0]).toMatchObject({ code: 'forbidden' });
  });

  it('answers ping and ends the session', () => {
    const pong = teacher(base(), { v: 1, type: 'ping' }, 4242);
    expect(pong.reply).toEqual([{ v: 1, type: 'pong', serverNow: 4242 }]);
    let r = teacher(base(), { v: 1, type: 'teacher.session.end' });
    expect(r.state.status).toBe('ended');
    expect(r.broadcast).toEqual([{ v: 1, type: 'session.ended' }]);
    r = teacher(r.state, { v: 1, type: 'teacher.screen.set', index: 1 });
    expect(r.reply[0]).toMatchObject({ code: 'session_ended' });
    expect(r.state.screenIndex).toBe(0);
  });
});
