<script lang="ts">
  import type {
    ClassSummary,
    Course,
    JoinClass,
    LessonSummary,
    Pics,
    Student,
    Teacher,
  } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { loadCourses, loadPics } from '../../lib/content.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import StudentList from '../../lib/ui/StudentList.svelte';

  let { params: _params }: PageProps = $props();
  let teacher = $state<Teacher | null>(null);
  let classes = $state<ClassSummary[]>([]);
  let courses = $state<Course[]>([]);
  let joinInfo = $state<JoinClass[]>([]);
  let students = $state<Student[]>([]);
  let pics = $state<Pics>({});
  let showStudents = $state(false);
  let error = $state<string | null>(null);
  let busy = $state<string | null>(null);

  const cls = $derived(classes[0]);
  const active = $derived(joinInfo.find((j) => j.id === cls?.id)?.activeSession ?? null);

  /** Lesson rows as in the author's KTP grid: lesson number → government programme lesson / club lesson. */
  const rows = $derived.by(() => {
    // A temporary index built inside a derived; not reactive state itself.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const byNum = new Map<number, { gos?: LessonSummary; krujok?: LessonSummary }>();
    for (const course of courses) {
      for (const lesson of course.lessons) {
        const row = byNum.get(lesson.num) ?? {};
        row[lesson.group] = lesson;
        byNum.set(lesson.num, row);
      }
    }
    return [...byNum.entries()].sort(([a], [b]) => a - b);
  });

  async function load(): Promise<void> {
    try {
      const me = await api.me();
      teacher = me.teacher;
      classes = me.classes;
      const [c, j, p] = await Promise.all([loadCourses(), api.joinClasses(), loadPics()]);
      courses = c;
      joinInfo = j.classes;
      pics = p;
      const first = me.classes[0];
      if (first) students = (await api.classDetails(first.id)).students;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.navigate('/teacher/login', { replace: true });
        return;
      }
      error = e instanceof Error ? e.message : t('common.error');
    }
  }

  async function start(lessonId: string): Promise<void> {
    if (!cls) return;
    busy = lessonId;
    try {
      const { session } = await api.createSession({ classId: cls.id, lessonId });
      router.navigate(`/teacher/session/${session.id}`);
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.error');
      busy = null;
    }
  }

  async function logout(): Promise<void> {
    await api.logout();
    router.navigate('/', { replace: true });
  }

  onMount(() => void load());
</script>

<Header>
  {#if teacher}
    <span class="who">{teacher.fullName}</span>
    <Button variant="ghost" onclick={logout}>{t('teacher.logout')}</Button>
  {/if}
</Header>

<main class="page">
  {#if error}
    <Notice kind="error">{error}</Notice>
  {:else if !teacher}
    <p aria-busy="true">{t('common.loading')}</p>
  {:else}
    {#if cls}
      <section class="top">
        <Card>
          <h1>{t('teacher.class', { name: cls.name })}</h1>
          <p class="muted">{t('teacher.students', { count: cls.studentCount })}</p>
          <p class="muted">{t('teacher.demo.hint')}</p>
          <div class="actions">
            <Button variant="secondary" href={`/teacher/class/${cls.id}/cards`}
              >{t('teacher.cards')}</Button
            >
            <Button variant="ghost" onclick={() => (showStudents = !showStudents)}>
              {t('teacher.students.title')}
              {showStudents ? '▴' : '▾'}
            </Button>
          </div>
        </Card>
        {#if active}
          <Card accent>
            <h2>{t('teacher.session.active', { title: active.lessonTitle })}</h2>
            <div class="actions">
              <Button href={`/teacher/session/${active.id}`}>{t('teacher.session.continue')}</Button
              >
              <Button variant="secondary" href={`/present/${active.id}`}
                >{t('session.projector')}</Button
              >
            </div>
          </Card>
        {/if}
      </section>
    {/if}

    {#if showStudents}
      <section class="students">
        <StudentList
          {students}
          {pics}
          onChange={(u: Student) => (students = students.map((s) => (s.id === u.id ? u : s)))}
        />
      </section>
    {/if}

    <h2>{t('teacher.lessons')}</h2>
    <div class="ktp">
      <div class="khead">
        <span></span>
        <div class="kh">{t('teacher.group.gos')}</div>
        <div class="kh kr">{t('teacher.group.krujok')}</div>
      </div>
      {#each rows as [num, row] (num)}
        <div class="krow">
          <div class="knum">
            <small>{t('teacher.lesson.number', { num: '' }).trim()}</small>{num}
          </div>
          {#each [row.gos, row.krujok] as lesson, i (i)}
            {#if lesson}
              <Card padded={false}>
                <div class="lcard" class:kr={lesson.group === 'krujok'}>
                  <div class="icon">{@html lesson.icon}</div>
                  <div class="info">
                    <div class="num">{t(`teacher.group.${lesson.group}`)}</div>
                    <b>{lesson.title}</b>
                    <div class="ls">{lesson.sub}</div>
                    <div class="ls">{t('teacher.lesson.screens', { count: lesson.screens })}</div>
                  </div>
                  <div class="btns">
                    <Button
                      size="md"
                      disabled={busy === lesson.id}
                      onclick={() => start(lesson.id)}
                    >
                      {t('teacher.lesson.start')}
                    </Button>
                    <Button size="md" variant="secondary" href={`/teacher/lesson/${lesson.id}`}>
                      {t('teacher.lesson.open')}
                    </Button>
                  </div>
                </div>
              </Card>
            {:else}
              <div class="empty"></div>
            {/if}
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</main>

<style>
  .who {
    color: var(--c-muted);
  }
  .top {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
  }
  .muted {
    color: var(--c-muted);
  }
  .actions {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .students {
    margin-bottom: var(--space-5);
  }
  .ktp {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .khead,
  .krow {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--space-3);
    align-items: stretch;
  }
  .kh {
    font-weight: 700;
    color: var(--c-accent);
    padding-left: var(--space-2);
  }
  .kh.kr {
    color: #6a32b0;
  }
  .knum {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--c-surface);
    border-radius: var(--radius-lg);
    font-size: var(--text-xl);
    font-weight: 900;
    color: var(--c-dark);
    border: 1px solid var(--c-line);
  }
  .knum small {
    font-size: 11px;
    text-transform: uppercase;
    color: var(--c-muted);
    font-weight: 700;
  }
  .lcard {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr) auto;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-3);
  }
  .icon :global(svg) {
    width: 96px;
    height: 72px;
    border-radius: var(--radius);
    display: block;
  }
  .num {
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    color: var(--c-accent);
  }
  .kr .num {
    color: #6a32b0;
  }
  .lcard b {
    display: block;
    color: var(--c-dark);
    font-size: var(--text-lg);
    line-height: 1.15;
    margin: 2px 0 4px;
  }
  .ls {
    color: var(--c-muted);
    font-size: var(--text-sm);
  }
  .btns {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .empty {
    border: 2px dashed var(--c-line);
    border-radius: var(--radius-lg);
  }
  @media (max-width: 900px) {
    .top,
    .khead,
    .krow {
      grid-template-columns: 1fr;
    }
    .khead {
      display: none;
    }
    .knum {
      flex-direction: row;
      gap: var(--space-2);
      padding: var(--space-2);
      font-size: var(--text-lg);
    }
    .lcard {
      grid-template-columns: 72px 1fr;
    }
    .btns {
      grid-column: 1 / -1;
      flex-direction: row;
    }
  }
</style>
