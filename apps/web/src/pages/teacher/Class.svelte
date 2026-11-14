<script lang="ts">
  import {
    MAX_STUDENTS_PER_CLASS,
    parseRoster,
    type ClassSummary,
    type Pics,
    type Student,
  } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { loadPics } from '../../lib/content.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import StudentList from '../../lib/ui/StudentList.svelte';

  /** Class page (S2.2): the register, pasting a roster, fixing names, cards for printing. */

  let { params }: PageProps = $props();
  const classId = $derived(params['id'] ?? '');

  let cls = $state<ClassSummary | null>(null);
  let students = $state<Student[]>([]);
  let pics = $state<Pics>({});
  let error = $state<string | null>(null);
  let busy = $state(false);
  let pasted = $state('');
  let report = $state<{ added: number; skipped: string[] } | null>(null);

  /** What the paste holds, shown before anything is sent. */
  const preview = $derived(pasted.trim() ? parseRoster(pasted) : null);
  const room = $derived(MAX_STUDENTS_PER_CLASS - students.length);

  async function load(): Promise<void> {
    try {
      const [details, p] = await Promise.all([api.classDetails(classId), loadPics()]);
      cls = details.class;
      students = details.students;
      pics = p;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.navigate('/teacher/login', { replace: true });
        return;
      }
      error = e instanceof ApiError && e.status === 404 ? t('class.notFound') : t('common.error');
    }
  }

  async function addStudents(): Promise<void> {
    if (!preview || preview.students.length === 0) return;
    busy = true;
    error = null;
    try {
      const res = await api.addStudents(classId, { students: preview.students });
      students = res.students;
      cls = res.class;
      report = { added: res.added, skipped: res.skipped };
      pasted = '';
    } catch (e) {
      error =
        e instanceof ApiError && e.code === 'class_full'
          ? t('class.full', { limit: MAX_STUDENTS_PER_CLASS })
          : t('common.error');
    } finally {
      busy = false;
    }
  }

  async function rename(student: Student, lastName: string, firstName: string): Promise<void> {
    const details = await api.updateStudent(student.id, { lastName, firstName });
    students = details.students;
    cls = details.class;
  }

  async function remove(student: Student): Promise<void> {
    const details = await api.removeStudent(student.id);
    students = details.students;
    cls = details.class;
  }

  onMount(() => void load());
</script>

<Header back="/teacher" />

<main class="page">
  {#if error && !cls}
    <Notice kind="error">{error}</Notice>
  {:else if !cls}
    <p aria-busy="true">{t('common.loading')}</p>
  {:else}
    <section class="top">
      <Card>
        <h1>{t('teacher.class', { name: cls.name })}</h1>
        <p class="muted">
          {t('teacher.students', { count: cls.studentCount })}
          {#if cls.schoolName}· {cls.schoolName}{:else}· {t('class.personal')}{/if}
        </p>
        <div class="actions">
          <Button variant="secondary" href={`/teacher/class/${cls.id}/cards`}>
            {t('teacher.cards')}
          </Button>
        </div>
      </Card>

      <Card>
        <h2>{t('class.add.title')}</h2>
        <p class="muted">{t('class.add.hint')}</p>
        <textarea
          bind:value={pasted}
          rows="6"
          placeholder={t('class.add.placeholder')}
          aria-label={t('class.add.title')}
        ></textarea>
        {#if preview}
          <p class="count">
            {t('class.add.found', { count: preview.students.length })}
            {#if room < preview.students.length}
              <span class="warn">{t('class.add.tooMany', { room })}</span>
            {/if}
          </p>
          {#if preview.problems.length > 0}
            <ul class="problems">
              {#each preview.problems as p (p.line)}
                <li>
                  <b>{t('class.add.line', { line: p.line })}</b>
                  «{p.text}» — {t(`class.add.problem.${p.reason}`)}
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
        {#if error}<Notice kind="error">{error}</Notice>{/if}
        {#if report}
          <Notice kind="info">
            {t('class.add.added', { count: report.added })}
            {#if report.skipped.length > 0}
              · {t('class.add.skipped', { names: report.skipped.join(', ') })}
            {/if}
          </Notice>
        {/if}
        <Button
          size="lg"
          disabled={busy || !preview || preview.students.length === 0}
          onclick={addStudents}
        >
          {t('class.add.submit')}
        </Button>
      </Card>
    </section>

    <h2>{t('teacher.students.title')}</h2>
    {#if students.length === 0}
      <p class="muted">{t('class.noStudents')}</p>
    {:else}
      <StudentList
        {students}
        {pics}
        editable
        onChange={(u: Student) => (students = students.map((s) => (s.id === u.id ? u : s)))}
        onRename={rename}
        onRemove={remove}
      />
    {/if}
  {/if}
</main>

<style>
  .top {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    margin-bottom: var(--space-5);
  }
  .actions {
    margin-top: var(--space-3);
  }
  textarea {
    width: 100%;
    margin-top: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    font: inherit;
    resize: vertical;
  }
  .count {
    margin: var(--space-2) 0;
    font-weight: 600;
    color: var(--c-dark);
  }
  .warn {
    color: var(--c-danger);
    margin-left: var(--space-2);
  }
  .problems {
    margin: 0 0 var(--space-3);
    padding-left: var(--space-4);
    color: var(--c-muted);
    font-size: var(--text-sm);
  }
  @media (max-width: 900px) {
    .top {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
