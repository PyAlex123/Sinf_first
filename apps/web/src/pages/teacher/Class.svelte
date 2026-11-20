<script lang="ts">
  import {
    DEFAULT_GRADE_THRESHOLDS,
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
  import EmptyState from '../../lib/ui/EmptyState.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';
  import StudentList from '../../lib/ui/StudentList.svelte';
  import SeatPlan from './SeatPlan.svelte';

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
  let canEditSettings = $state(false);
  let savingSettings = $state(false);

  /** What the paste holds, shown before anything is sent. */
  const preview = $derived(pasted.trim() ? parseRoster(pasted) : null);
  const room = $derived(MAX_STUDENTS_PER_CLASS - students.length);

  async function load(): Promise<void> {
    try {
      const [details, p] = await Promise.all([api.classDetails(classId), loadPics()]);
      cls = details.class;
      students = details.students;
      canEditSettings = details.canEditSettings;
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

  /** Grades are worked out when results are read, so the switch applies to past lessons too. */
  async function setStarsToGrade(value: boolean): Promise<void> {
    savingSettings = true;
    error = null;
    try {
      const details = await api.setStarsToGrade(classId, value);
      cls = details.class;
      canEditSettings = details.canEditSettings;
    } catch {
      error = t('common.error');
    } finally {
      savingSettings = false;
    }
  }

  onMount(() => void load());
</script>

<Header back="/teacher" />

<main class="page stack">
  {#if error && !cls}
    <Notice kind="error">{error}</Notice>
  {:else if !cls}
    <p aria-busy="true" class="muted">{t('common.loading')}</p>
  {:else}
    <PageHeader
      title={t('teacher.class', { name: cls.name })}
      subtitle={`${t('teacher.students', { count: cls.studentCount })} · ${
        cls.schoolName ?? t('class.personal')
      }`}
    >
      {#snippet actions()}
        <Button variant="secondary" href={`/teacher/journal/${cls?.id}`}>
          {t('teacher.journal')}
        </Button>
        <Button variant="secondary" href={`/teacher/class/${cls?.id}/cards`}>
          {t('teacher.cards')}
        </Button>
      {/snippet}
    </PageHeader>

    <div class="cols">
      <section class="stack">
        <h2>{t('teacher.students.title')}</h2>
        {#if students.length === 0}
          <EmptyState
            icon="student"
            title={t('class.noStudents')}
            text={t('class.noStudents.hint')}
          />
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
        <!-- Only on the classroom's teacher computer; elsewhere it shows nothing (H8). -->
        {#if students.length > 0}<SeatPlan {classId} {students} />{/if}
      </section>

      <aside class="stack">
        <Card>
          <h2>{t('class.settings.title')}</h2>
          <label class="switch">
            <input
              type="checkbox"
              checked={cls.settings.starsToGrade}
              disabled={!canEditSettings || savingSettings}
              onchange={(e) => void setStarsToGrade(e.currentTarget.checked)}
            />
            <span>{t('class.settings.starsToGrade')}</span>
          </label>
          <p class="muted small">
            {canEditSettings
              ? t('class.settings.hint', cls.settings.gradeThresholds ?? DEFAULT_GRADE_THRESHOLDS)
              : t('class.settings.locked')}
          </p>
        </Card>
        <Card>
          <h2>{t('class.add.title')}</h2>
          <p class="muted small">{t('class.add.hint')}</p>
          <textarea
            class="paste"
            bind:value={pasted}
            rows="6"
            placeholder={t('class.add.placeholder')}
            aria-label={t('class.add.title')}
          ></textarea>
          {#if preview}
            <p class="count">
              <Icon name="check" size={16} />
              {t('class.add.found', { count: preview.students.length })}
            </p>
            {#if room < preview.students.length}
              <Notice kind="warn">{t('class.add.tooMany', { room })}</Notice>
            {/if}
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
            <Notice kind="ok">
              {t('class.add.added', { count: report.added })}
              {#if report.skipped.length > 0}
                · {t('class.add.skipped', { names: report.skipped.join(', ') })}
              {/if}
            </Notice>
          {/if}
          <div class="go">
            <Button
              size="lg"
              block
              disabled={busy || !preview || preview.students.length === 0}
              onclick={addStudents}
            >
              {t('class.add.submit')}
            </Button>
          </div>
        </Card>
      </aside>
    </div>
  {/if}
</main>

<style>
  /* The roster is the page; pasting a list is the tool beside it. */
  .cols {
    display: grid;
    gap: var(--space-5);
    grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
    align-items: start;
  }
  .paste {
    width: 100%;
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius);
    font: inherit;
    line-height: var(--leading-normal);
    resize: vertical;
  }
  .count {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-3) 0;
    font-weight: 600;
    color: var(--c-ok);
  }
  .problems {
    margin: 0 0 var(--space-3);
    padding-left: var(--space-4);
    color: var(--c-muted);
    font-size: var(--text-sm);
  }
  .go {
    margin-top: var(--space-4);
  }
  .switch {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin-top: var(--space-3);
    font-weight: 600;
    color: var(--c-dark);
    cursor: pointer;
  }
  .switch input {
    width: 20px;
    height: 20px;
    margin: 2px 0 0;
    flex: none;
    accent-color: var(--c-accent);
  }
  @media (max-width: 900px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
