<script lang="ts">
  import type {
    ClassSummary,
    MySchool,
    SchoolBrief,
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
  import { platform } from '../../lib/platform.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Badge from '../../lib/ui/Badge.svelte';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import EmptyState from '../../lib/ui/EmptyState.svelte';
  import Field from '../../lib/ui/Field.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import StudentList from '../../lib/ui/StudentList.svelte';

  let { params: _params }: PageProps = $props();
  let teacher = $state<Teacher | null>(null);
  let classes = $state<ClassSummary[]>([]);
  let schoolsOfMine = $state<MySchool[]>([]);
  let pendingSchool = $state<SchoolBrief | null>(null);
  let isSuperadmin = $state(false);
  let courses = $state<Course[]>([]);
  let joinInfo = $state<JoinClass[]>([]);
  let students = $state<Student[]>([]);
  let pics = $state<Pics>({});
  let showStudents = $state(false);
  let error = $state<string | null>(null);
  let busy = $state<string | null>(null);

  let selectedId = $state<string | null>(null);
  /** The class the teacher is working with; the first one until they pick another (S2.2). */
  const cls = $derived(classes.find((c) => c.id === selectedId) ?? classes[0]);

  let creating = $state(false);
  let newName = $state('');
  let newGrade = $state(1);
  let newSchoolId = $state<string | null>(null);
  /** Schools seen among the teacher's classes; the picker only shows up when there are several. */
  const schools = $derived(
    classes
      .filter((c) => c.schoolId && c.schoolName)
      .map((c) => ({ id: c.schoolId as string, name: c.schoolName as string }))
      .filter((school, i, all) => all.findIndex((s) => s.id === school.id) === i),
  );

  async function createClass(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!newName.trim()) return;
    busy = 'class';
    error = null;
    try {
      const { class: created } = await api.createClass({
        name: newName.trim(),
        grade: newGrade,
        ...(newSchoolId ? { schoolId: newSchoolId } : {}),
      });
      router.navigate(`/teacher/class/${created.id}`);
    } catch (e) {
      error = e instanceof Error ? e.message : t('common.error');
    } finally {
      busy = null;
    }
  }
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
      schoolsOfMine = me.schools;
      pendingSchool = me.pendingSchool;
      isSuperadmin = me.isSuperadmin;
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
    <span class="who muted small">{teacher.fullName}</span>
    <Button variant="ghost" size="sm" onclick={logout}>{t('teacher.logout')}</Button>
  {/if}
</Header>

<main class="page">
  {#if error}
    <Notice kind="error">{error}</Notice>
  {:else if !teacher}
    <p aria-busy="true" class="muted">{t('common.loading')}</p>
  {:else}
    <!-- Left: the class being taught. Right: the lessons to teach it. -->
    <div class="cols">
      <aside class="side stack">
        {#if classes.length > 1}
          <div class="picker" role="group" aria-label={t('teacher.class', { name: '' }).trim()}>
            {#each classes as c (c.id)}
              <button
                type="button"
                class="chip"
                class:on={c.id === cls?.id}
                aria-pressed={c.id === cls?.id}
                onclick={() => (selectedId = c.id)}
              >
                {c.name}
              </button>
            {/each}
          </div>
        {/if}

        {#if cls}
          <Card>
            <h1>{t('teacher.class', { name: cls.name })}</h1>
            <p class="meta">
              <span><Icon name="student" size={16} /></span>
              {t('teacher.students', { count: cls.studentCount })}
            </p>
            <p class="meta">
              <span><Icon name="school" size={16} /></span>
              {cls.schoolName ?? t('class.personal')}
            </p>
            <div class="actions">
              <Button variant="secondary" size="sm" href={`/teacher/class/${cls.id}`}>
                {t('class.manage')}
              </Button>
              <Button variant="secondary" size="sm" href={`/teacher/class/${cls.id}/cards`}>
                {t('teacher.cards')}
              </Button>
              <Button variant="ghost" size="sm" onclick={() => (showStudents = !showStudents)}>
                {t('teacher.students.title')}
                {showStudents ? '▴' : '▾'}
              </Button>
            </div>
          </Card>
        {:else}
          <EmptyState
            icon="student"
            level={1}
            title={t('teacher.noClasses')}
            text={t('teacher.noClasses.hint')}
          />
        {/if}

        {#if active}
          <Card accent>
            <h2>{t('teacher.session.active', { title: active.lessonTitle })}</h2>
            <div class="actions">
              <Button size="sm" href={`/teacher/session/${active.id}`}>
                {t('teacher.session.continue')}
              </Button>
              <Button variant="secondary" size="sm" href={`/present/${active.id}`}>
                {t('session.projector')}
              </Button>
            </div>
          </Card>
        {/if}

        {#if creating}
          <Card>
            <h2>{t('class.create.title')}</h2>
            <form onsubmit={createClass}>
              <Field label={t('class.create.name')}>
                <input bind:value={newName} required maxlength="20" placeholder="5Б" />
              </Field>
              <Field label={t('class.create.grade')}>
                <select bind:value={newGrade}>
                  {#each Array.from({ length: 11 }, (_, i) => i + 1) as g (g)}
                    <option value={g}>{g}</option>
                  {/each}
                </select>
              </Field>
              {#if schools.length > 1}
                <Field label={t('class.create.school')}>
                  <select bind:value={newSchoolId}>
                    {#each schools as school (school.id)}
                      <option value={school.id}>{school.name}</option>
                    {/each}
                  </select>
                </Field>
              {/if}
              <div class="actions">
                <Button type="submit" disabled={busy === 'class'}>
                  {t('class.create.submit')}
                </Button>
                <Button variant="ghost" onclick={() => (creating = false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </Card>
        {:else}
          <Button variant="secondary" block onclick={() => (creating = true)}>
            <Icon name="plus" />
            {t('class.create.open')}
          </Button>
        {/if}

        <!-- Where this teacher belongs: their school, or the way to ask for one. -->
        <Card muted>
          <h3>{t('teacher.school')}</h3>
          <div class="schools">
            {#each schoolsOfMine as school (school.id)}
              <a class="school" href={`/school/${school.id}`}>
                <Icon name="school" size={16} />
                <span>{school.name}</span>
                {#if school.role === 'admin'}<Badge tone="accent">{t('school.role.admin')}</Badge
                  >{/if}
              </a>
            {/each}
            {#if schoolsOfMine.length === 0}
              {#if pendingSchool}
                <p class="muted small">{t('schools.pending', { name: pendingSchool.name })}</p>
              {:else}
                <Button variant="secondary" size="sm" href="/teacher/schools">
                  {t('teacher.school.find')}
                </Button>
              {/if}
            {/if}
            {#if isSuperadmin}
              <Button variant="ghost" size="sm" href="/admin">{t('admin.open')}</Button>
            {/if}
          </div>
        </Card>

        <p class="muted small hint">
          {platform.lanUrl
            ? t('teacher.demo.hintDesktop', { url: platform.lanUrl })
            : t('teacher.demo.hint')}
        </p>
      </aside>

      <section class="lessons">
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
                        <div class="group">{t(`teacher.group.${lesson.group}`)}</div>
                        <b>{lesson.title}</b>
                        <div class="ls">{lesson.sub}</div>
                        <div class="ls">
                          {t('teacher.lesson.screens', { count: lesson.screens })}
                        </div>
                      </div>
                      <div class="btns">
                        <Button
                          size="sm"
                          disabled={busy === lesson.id || !cls}
                          onclick={() => start(lesson.id)}
                        >
                          <Icon name="play" size={16} />
                          {t('teacher.lesson.start')}
                        </Button>
                        <Button size="sm" variant="ghost" href={`/teacher/lesson/${lesson.id}`}>
                          {t('teacher.lesson.open')}
                        </Button>
                      </div>
                    </div>
                  </Card>
                {:else}
                  <div class="hole"></div>
                {/if}
              {/each}
            </div>
          {/each}
        </div>
      </section>
    </div>

    {#if showStudents}
      <section class="students">
        <StudentList
          {students}
          {pics}
          onChange={(u: Student) => (students = students.map((s) => (s.id === u.id ? u : s)))}
        />
      </section>
    {/if}
  {/if}
</main>

<style>
  .cols {
    display: grid;
    grid-template-columns: minmax(280px, 320px) minmax(0, 1fr);
    gap: var(--space-5);
    align-items: start;
  }
  .side {
    position: sticky;
    top: var(--space-4);
    gap: var(--space-4);
  }
  .who {
    overflow: hidden;
    display: inline-block;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 30ch;
  }
  .picker {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .chip {
    min-height: var(--control-sm);
    padding: 0 var(--space-4);
    border: 1px solid var(--c-line-strong);
    border-radius: var(--radius-pill);
    background: var(--c-surface);
    font-weight: 700;
    color: var(--c-muted);
  }
  .chip.on {
    border-color: var(--c-accent);
    background: var(--c-accent-soft);
    color: var(--c-accent-strong);
  }
  .meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-1);
    color: var(--c-muted);
  }
  .meta span {
    display: inline-flex;
    color: var(--c-line-strong);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin-top: var(--space-3);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .schools {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
  }
  .school {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--c-dark);
    font-weight: 600;
    text-decoration: none;
  }
  .school:hover {
    color: var(--c-accent-strong);
  }
  .hint {
    margin: 0;
  }

  .ktp {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .khead,
  .krow {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--space-3);
    align-items: stretch;
  }
  .kh {
    font-size: var(--text-sm);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--c-accent);
  }
  .kh.kr {
    color: #6a32b0;
  }
  .knum {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--c-bg-2);
    border-radius: var(--radius-lg);
    font-size: var(--text-lg);
    font-weight: 800;
    color: var(--c-dark);
  }
  .knum small {
    font-size: var(--text-xs);
    text-transform: uppercase;
    color: var(--c-muted);
    font-weight: 700;
  }
  .lcard {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    gap: var(--space-3);
    padding: var(--space-3);
    height: 100%;
    align-content: start;
  }
  .icon :global(svg) {
    width: 72px;
    height: 54px;
    border-radius: var(--radius);
    display: block;
  }
  .group {
    font-size: var(--text-xs);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--c-accent);
  }
  .kr .group {
    color: #6a32b0;
  }
  .lcard b {
    display: block;
    color: var(--c-dark);
    font-size: var(--text-md);
    line-height: var(--leading-tight);
    margin: var(--space-1) 0;
  }
  .ls {
    color: var(--c-muted);
    font-size: var(--text-sm);
  }
  .btns {
    grid-column: 1 / -1;
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  /* A lesson number with no club lesson: the slot stays, so the rows keep lining up. */
  .hole {
    border: 1px dashed var(--c-line);
    border-radius: var(--radius-lg);
  }
  .students {
    margin-top: var(--space-5);
  }

  @media (max-width: 560px) {
    /* On a phone the header has room for the brand and the way out, not for the name. */
    .who {
      display: none;
    }
  }
  @media (max-width: 1000px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }
    .side {
      position: static;
    }
  }
  @media (max-width: 760px) {
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
    }
  }
</style>
