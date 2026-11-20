import { describe, expect, it } from 'vitest';
import { readPlatform } from '../src/lib/platform.js';

/** The bridge to the Windows app (CLAUDE.md §5.5, ADR-014): what each host may say about itself. */
describe('readPlatform', () => {
  it('is a plain browser when nothing was injected', () => {
    expect(readPlatform(undefined)).toEqual({
      isDesktop: false,
      role: null,
      version: null,
      lanUrl: null,
      pcName: null,
    });
    expect(readPlatform({ role: 'student' }).isDesktop).toBe(false);
  });

  it('reads the teacher window', () => {
    expect(
      readPlatform({
        isDesktop: true,
        role: 'teacher',
        version: '0.1.0.0',
        lanUrl: 'http://192.168.1.15:3000',
      }),
    ).toEqual({
      isDesktop: true,
      role: 'teacher',
      version: '0.1.0.0',
      lanUrl: 'http://192.168.1.15:3000',
      pcName: null,
    });
  });

  it('reads a student window with its computer name', () => {
    const p = readPlatform({ isDesktop: true, role: 'student', pcName: '  ПК-05 ' });
    expect(p.role).toBe('student');
    expect(p.pcName).toBe('ПК-05');
  });

  it('drops values it does not understand', () => {
    const p = readPlatform({
      isDesktop: true,
      role: 'admin',
      lanUrl: 'javascript:alert(1)',
      pcName: 42,
    });
    expect(p).toMatchObject({ isDesktop: true, role: null, lanUrl: null, pcName: null });
  });
});
