import type { RouteDef } from './lib/router.svelte.js';

/** Routes of STAGE1.md §6. Pages load on demand so the first screen stays small. */
export const routes: RouteDef[] = [
  { pattern: '/', load: () => import('./pages/Home.svelte') },
  { pattern: '/teacher/login', load: () => import('./pages/teacher/Login.svelte') },
  { pattern: '/teacher/register', load: () => import('./pages/teacher/Register.svelte') },
  { pattern: '/teacher/forgot', load: () => import('./pages/teacher/Forgot.svelte') },
  { pattern: '/teacher/reset/:token', load: () => import('./pages/teacher/Reset.svelte') },
  { pattern: '/teacher', load: () => import('./pages/teacher/Dashboard.svelte') },
  { pattern: '/teacher/lesson/:id', load: () => import('./pages/teacher/Lesson.svelte') },
  { pattern: '/teacher/programs', load: () => import('./pages/teacher/Programs.svelte') },
  { pattern: '/teacher/library', load: () => import('./pages/teacher/Library.svelte') },
  { pattern: '/teacher/ktp', load: () => import('./pages/teacher/Ktp.svelte') },
  { pattern: '/teacher/ktp/import', load: () => import('./pages/teacher/KtpImport.svelte') },
  { pattern: '/teacher/ktp/:id', load: () => import('./pages/teacher/KtpPlan.svelte') },
  { pattern: '/teacher/programs/:id', load: () => import('./pages/teacher/ProgramEditor.svelte') },
  {
    pattern: '/teacher/lessons/:id/edit',
    load: () => import('./pages/teacher/LessonEditor.svelte'),
  },
  { pattern: '/teacher/class/:id/cards', load: () => import('./pages/teacher/Cards.svelte') },
  {
    pattern: '/teacher/class/:id/report',
    load: () => import('./pages/teacher/ClassReport.svelte'),
  },
  { pattern: '/teacher/class/:id', load: () => import('./pages/teacher/Class.svelte') },
  { pattern: '/teacher/schools', load: () => import('./pages/teacher/Schools.svelte') },
  { pattern: '/school/:id', load: () => import('./pages/teacher/School.svelte') },
  { pattern: '/admin', load: () => import('./pages/Admin.svelte') },
  {
    pattern: '/teacher/session/:id/results',
    load: () => import('./pages/teacher/Results.svelte'),
  },
  { pattern: '/teacher/session/:id', load: () => import('./pages/teacher/Session.svelte') },
  {
    pattern: '/teacher/journal/:classId/import',
    load: () => import('./pages/teacher/JournalImport.svelte'),
  },
  { pattern: '/teacher/journal/:classId', load: () => import('./pages/teacher/Journal.svelte') },
  { pattern: '/teacher/demo', load: () => import('./pages/teacher/Demo.svelte') },
  { pattern: '/present/:id', load: () => import('./pages/Present.svelte') },
  { pattern: '/join', load: () => import('./pages/Join.svelte') },
  { pattern: '/invite/:token', load: () => import('./pages/Invite.svelte') },
  { pattern: '/s/:id', load: () => import('./pages/Student.svelte') },
  { pattern: '/my', load: () => import('./pages/MyFiles.svelte') },
  { pattern: '/teacher/practice', load: () => import('./pages/teacher/Practice.svelte') },
  {
    pattern: '/teacher/student/:id/files',
    load: () => import('./pages/teacher/StudentFiles.svelte'),
  },
];
