import type { RouteDef } from './lib/router.svelte.js';

/** Routes of STAGE1.md §6. Pages load on demand so the first screen stays small. */
export const routes: RouteDef[] = [
  { pattern: '/', load: () => import('./pages/Home.svelte') },
  { pattern: '/teacher/login', load: () => import('./pages/teacher/Login.svelte') },
  { pattern: '/teacher/register', load: () => import('./pages/teacher/Register.svelte') },
  { pattern: '/teacher', load: () => import('./pages/teacher/Dashboard.svelte') },
  { pattern: '/teacher/lesson/:id', load: () => import('./pages/teacher/Lesson.svelte') },
  { pattern: '/teacher/class/:id/cards', load: () => import('./pages/teacher/Cards.svelte') },
  { pattern: '/teacher/class/:id', load: () => import('./pages/teacher/Class.svelte') },
  { pattern: '/teacher/session/:id', load: () => import('./pages/teacher/Session.svelte') },
  { pattern: '/present/:id', load: () => import('./pages/Present.svelte') },
  { pattern: '/join', load: () => import('./pages/Join.svelte') },
  { pattern: '/s/:id', load: () => import('./pages/Student.svelte') },
];
