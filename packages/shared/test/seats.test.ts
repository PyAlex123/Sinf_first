import { describe, expect, it } from 'vitest';
import { comparePcNames, SeatUpdateSchema } from '../src/index.js';

describe('comparePcNames', () => {
  it('orders computers by their number, not as strings', () => {
    const pcs = ['ПК-12', 'ПК-2', 'ПК-05', 'ПК-1', 'ПК-5', 'Учитель'];
    expect([...pcs].sort(comparePcNames)).toEqual([
      'ПК-1',
      'ПК-2',
      'ПК-5',
      'ПК-05',
      'ПК-12',
      'Учитель',
    ]);
  });

  it('is a stable total order', () => {
    expect(comparePcNames('ПК-05', 'ПК-05')).toBe(0);
    expect(Math.sign(comparePcNames('pk-3', 'PK-3'))).toBe(
      -Math.sign(comparePcNames('PK-3', 'pk-3')),
    );
  });
});

describe('SeatUpdateSchema', () => {
  it('takes a child or null, and a trimmed computer name', () => {
    expect(SeatUpdateSchema.parse({ pc: ' ПК-05 ', studentId: null })).toEqual({
      pc: 'ПК-05',
      studentId: null,
    });
    expect(() => SeatUpdateSchema.parse({ pc: '', studentId: 's' })).toThrow();
  });
});
