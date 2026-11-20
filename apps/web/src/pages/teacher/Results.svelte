<script lang="ts">
  import { PRACTICE_MAX_STARS, registerDate, type SessionResults } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import EmptyState from '../../lib/ui/EmptyState.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Badge from '../../lib/ui/Badge.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';
  import Table from '../../lib/ui/Table.svelte';

  /**
   * Lesson results (S1.13): the whole class on one screen — who came, stars for the trainers and
   * the drawing, the quiz, and a 2–5 grade where the class has them — then the Paint drawings.
   */

  let { params }: PageProps = $props();
  const sessionId = $derived(params['id'] ?? '');

  let results = $state<SessionResults | null>(null);
  let error = $state<string | null>(null);

  /**
   * The drawing has a column and a gallery only when there was a drawing: the teacher gave stars or
   * the children marked steps. Some lessons carry a stray "step" slide that is no Paint at all.
   */
  const hasPractice = $derived(
    (results?.practiceSteps ?? 0) > 0 &&
      (results?.rows.some((r) => r.practiceStars !== null || (r.stepsDone ?? 0) > 0) ?? false),
  );
  const hasQuiz = $derived((results?.quizQuestions ?? 0) > 0);
  const present = $derived(results?.rows.filter((r) => r.present) ?? []);

  const subtitle = $derived.by(() => {
    if (!results) return '';
    const parts = [t('teacher.class', { name: results.class.name }), registerDate(results.date)];
    if (results.status === 'ended') {
      parts.push(
        t('results.present', { present: results.presentCount, total: results.rows.length }),
      );
    }
    return parts.join(' · ');
  });

  onMount(() => {
    void (async () => {
      try {
        results = await api.sessionResults(sessionId);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.navigate('/teacher/login', { replace: true });
          return;
        }
        error =
          e instanceof ApiError && e.status === 404 ? t('results.notFound') : t('common.error');
      }
    })();
  });
</script>

<Header back="/teacher" title={results?.lessonTitle ?? ''} />

<main class="page stack">
  {#if error}
    <Notice kind="error">{error}</Notice>
  {:else if !results}
    <p aria-busy="true" class="muted">{t('common.loading')}</p>
  {:else}
    <PageHeader title={t('results.title')} {subtitle}>
      {#snippet actions()}
        {#if results?.status === 'active'}
          <Button href={`/teacher/session/${results.sessionId}`}>
            {t('teacher.session.continue')}
          </Button>
        {/if}
        <Button variant="secondary" href={`/teacher/journal/${results?.class.id}`}>
          {t('teacher.journal')}
        </Button>
      {/snippet}
    </PageHeader>

    {#if results.status === 'active'}
      <Notice>{t('results.live')}</Notice>
    {/if}

    <Card>
      <Table>
        <thead>
          <tr>
            <th class="num">№</th>
            <th>{t('results.col.student')}</th>
            <th>{t('results.col.presence')}</th>
            <th class="n">{t('results.col.trainer')}</th>
            {#if hasPractice}<th class="n">{t('results.col.drawing')}</th>{/if}
            {#if hasQuiz}<th>{t('results.col.quiz')}</th>{/if}
            <th class="n">{t('results.col.total')}</th>
            {#if results.class.starsToGrade}<th class="n">{t('results.col.grade')}</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each results.rows as row, i (row.studentId)}
            <tr class:away={!row.present}>
              <td class="num">{i + 1}</td>
              <td class="name">
                {row.name}
                {#if row.isVirtual}<Badge tone="info">{t('virtual.short')}</Badge>{/if}
              </td>
              <td>{row.present ? t('results.here') : t('results.absent')}</td>
              {#if row.present}
                <td class="n">
                  ★ {t('results.of', { value: row.trainerStars, max: results.maxima.trainer })}
                </td>
                {#if hasPractice}
                  <td class="n">
                    {#if row.practiceStars}
                      <span
                        class="stars"
                        aria-label={t('session.stars', { count: row.practiceStars })}
                      >
                        {'★'.repeat(row.practiceStars)}<span class="off"
                          >{'★'.repeat(PRACTICE_MAX_STARS - row.practiceStars)}</span
                        >
                      </span>
                    {:else}
                      <span class="muted">—</span>
                    {/if}
                  </td>
                {/if}
                {#if hasQuiz}
                  <td>
                    {#if row.quizAnswered > 0}
                      {t('results.quizCell', {
                        points: row.quizPoints,
                        correct: row.quizCorrect,
                        asked: results.maxima.quiz,
                      })}
                    {:else}
                      <span class="muted">{t('results.quizNone')}</span>
                    {/if}
                  </td>
                {/if}
                <td class="n total">★ {row.totalStars}</td>
                {#if results.class.starsToGrade}
                  <td class="n">
                    {#if row.grade !== null}
                      <b class="grade g{row.grade}">{row.grade}</b>
                      <span class="muted small">{row.percent} %</span>
                    {:else}
                      <span class="muted">—</span>
                    {/if}
                  </td>
                {/if}
              {:else}
                <td class="n muted">—</td>
                {#if hasPractice}<td class="n muted">—</td>{/if}
                {#if hasQuiz}<td class="muted">—</td>{/if}
                <td class="n muted">—</td>
                {#if results.class.starsToGrade}<td class="n muted">—</td>{/if}
              {/if}
            </tr>
          {/each}
        </tbody>
      </Table>
      <p class="muted small hint">
        {results.class.starsToGrade
          ? t('results.gradeHint', results.class.thresholds)
          : t('results.gradeOff')}
      </p>
    </Card>

    {#if hasPractice}
      <section class="stack">
        <h2>{t('results.gallery')}</h2>
        {#if present.length === 0}
          <EmptyState icon="star" title={t('results.gallery.empty')} />
        {:else}
          <ul class="gallery">
            {#each present as row (row.studentId)}
              <li>
                <Card padded={false}>
                  <!-- Screenshots arrive with S1.14; until then the place says so honestly. -->
                  <div class="shot"><span>{t('results.gallery.noShot')}</span></div>
                  <div class="caption">
                    <b>{row.name}</b>
                    {#if row.practiceStars}
                      <span
                        class="stars"
                        aria-label={t('session.stars', { count: row.practiceStars })}
                      >
                        {'★'.repeat(row.practiceStars)}<span class="off"
                          >{'★'.repeat(PRACTICE_MAX_STARS - row.practiceStars)}</span
                        >
                      </span>
                    {:else}
                      <span class="muted small">{t('results.gallery.noStars')}</span>
                    {/if}
                    {#if row.stepsDone !== null}
                      <span class="muted small">
                        {t('results.gallery.steps', {
                          done: row.stepsDone,
                          total: results.practiceSteps,
                        })}
                      </span>
                    {/if}
                  </div>
                </Card>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  {/if}
</main>

<style>
  .n {
    white-space: nowrap;
  }
  .name {
    font-weight: 600;
  }
  .away td {
    color: var(--c-muted);
  }
  .away .name {
    font-weight: 400;
  }
  .total {
    font-weight: 600;
  }
  .stars {
    color: var(--c-star);
    letter-spacing: 0.1em;
  }
  .stars .off {
    color: var(--c-line-strong);
  }
  .grade {
    display: inline-block;
    min-width: 1.6em;
    text-align: center;
    font-size: var(--text-lg);
  }
  .g2 {
    color: var(--c-danger);
  }
  .g5 {
    color: var(--c-ok);
  }
  .hint {
    margin: var(--space-4) 0 0;
  }
  .gallery {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-4);
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  }
  .shot {
    aspect-ratio: 4 / 3;
    display: grid;
    place-items: center;
    background: var(--c-bg-2);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    color: var(--c-muted);
    font-size: var(--text-sm);
  }
  .caption {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
  }
</style>
