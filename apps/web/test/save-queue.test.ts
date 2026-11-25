import { describe, expect, it } from 'vitest';
import { SaveQueue } from '../src/lib/save-queue.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('save queue', () => {
  it('runs saves one at a time and in order, none dropped', async () => {
    const queue = new SaveQueue();
    const log: string[] = [];
    let running = 0;
    const save = (name: string) =>
      queue.run(async () => {
        running++;
        expect(running).toBe(1);
        log.push(`start ${name}`);
        await tick();
        log.push(`end ${name}`);
        running--;
        return name;
      });
    const results = await Promise.all(['5', '4', '3', '2'].map(save));
    expect(results).toEqual(['5', '4', '3', '2']);
    expect(log).toEqual([
      'start 5',
      'end 5',
      'start 4',
      'end 4',
      'start 3',
      'end 3',
      'start 2',
      'end 2',
    ]);
    expect(queue.size).toBe(0);
  });

  it('goes on after a failed save', async () => {
    const queue = new SaveQueue();
    const first = queue.run(() => Promise.reject(new Error('lesson_running')));
    const second = queue.run(() => Promise.resolve('saved'));
    await expect(first).rejects.toThrow('lesson_running');
    await expect(second).resolves.toBe('saved');
    expect(queue.size).toBe(0);
  });
});
