<script lang="ts">
  import type { CheckOutcome, ResultRow, SessionResults } from '@sinf/shared';
  import { api } from '../../lib/api.js';
  import { i18n, t } from '../../lib/i18n/index.svelte.js';
  import Badge from '../../lib/ui/Badge.svelte';
  import Card from '../../lib/ui/Card.svelte';

  /**
   * The practice's works (CLAUDE.md §4.7–4.8; H16): for each child the file handed in, every
   * criterion with what the checker found, and the teacher's marks — the manual criteria, and the
   * automatic ones the checker could not decide or decided wrongly. A mark is saved at once.
   */
  let { results, onChange }: { results: SessionResults; onChange: (next: SessionResults) => void } =
    $props();

  const practice = $derived(results.practice);
  const rows = $derived(results.rows.filter((r) => r.present));
  let saving = $state<string | null>(null);
  let failed = $state(false);

  async function mark(row: ResultRow, criterionId: string, value: boolean): Promise<void> {
    if (saving) return;
    const current = row.check?.marks[criterionId];
    saving = `${row.studentId}:${criterionId}`;
    failed = false;
    try {
      onChange(
        await api.setPracticeMarks(results.sessionId, row.studentId, {
          // The same button again takes the mark back.
          [criterionId]: current === value ? null : value,
        }),
      );
    } catch {
      failed = true;
    } finally {
      saving = null;
    }
  }

  const sign = (o: CheckOutcome): string => (o === 'pass' ? '✓' : o === 'fail' ? '✗' : '?');
</script>

{#if practice}
  <section class="stack" aria-label={t('results.works')}>
    <h2>{t('results.works')}</h2>
    {#if failed}<p class="err" role="alert">{t('common.error')}</p>{/if}
    <ul class="works">
      {#each rows as row (row.studentId)}
        {@const check = row.check}
        <li data-work={row.studentId}>
          <Card>
            <div class="head">
              <b>{row.name}</b>
              {#if check}
                <span class="pts" data-points={`${check.points}/${check.max}`}>
                  {t('results.works.points', { points: check.points, max: check.max })}
                </span>
              {/if}
            </div>
            {#if check?.fileName}
              <p class="file">
                <a href={api.practiceFileUrl(results.sessionId, row.studentId)} download>
                  {check.fileName}
                </a>
                {#if check.submitted}
                  <Badge tone="ok">{t('results.works.handedIn')}</Badge>
                {:else}
                  <Badge tone="info">{t('results.works.latest')}</Badge>
                {/if}
              </p>
              {#if check.file && check.file !== 'ok'}
                <p class="warn">{t(`practice.file.${check.file}`)}</p>
              {/if}
            {:else}
              <p class="muted small">{t('results.works.noFile')}</p>
            {/if}
            <ul class="crit">
              {#each practice.criteria as c (c.id)}
                {@const o = check?.outcomes[c.id] ?? 'unknown'}
                {@const m = check?.marks[c.id]}
                <li class={o}>
                  <span class="sign" aria-label={t(`practice.outcome.${o}`)}>{sign(o)}</span>
                  <span class="lab">
                    {c.label[i18n.contentLocale]}
                    <span class="muted small">· {c.points} {t('practice.pointsShort')}</span>
                    {#if check?.found[c.id] && m === undefined}
                      <span class="muted small found">{check.found[c.id]}</span>
                    {/if}
                    {#if c.kind === 'auto' && m !== undefined}
                      <span class="muted small">{t('results.works.byTeacher')}</span>
                    {/if}
                  </span>
                  <span class="marks" role="group" aria-label={t('results.works.mark')}>
                    <button
                      type="button"
                      class="yes"
                      class:on={m === true}
                      aria-pressed={m === true}
                      disabled={!!saving}
                      data-mark="yes"
                      onclick={() => mark(row, c.id, true)}>✓</button
                    >
                    <button
                      type="button"
                      class="no"
                      class:on={m === false}
                      aria-pressed={m === false}
                      disabled={!!saving}
                      data-mark="no"
                      onclick={() => mark(row, c.id, false)}>✗</button
                    >
                  </span>
                </li>
              {/each}
            </ul>
          </Card>
        </li>
      {/each}
    </ul>
    <p class="muted small">{t('results.works.hint')}</p>
  </section>
{/if}

<style>
  .works {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  }
  .head {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    align-items: baseline;
  }
  .pts {
    font-weight: 800;
  }
  .file {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
    margin: var(--space-2) 0;
    word-break: break-word;
  }
  .warn,
  .err {
    color: var(--c-danger);
  }
  .crit {
    list-style: none;
    margin: var(--space-2) 0 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }
  .crit li {
    display: grid;
    grid-template-columns: 1.4em 1fr auto;
    gap: var(--space-2);
    align-items: center;
  }
  .sign {
    font-weight: 800;
    text-align: center;
  }
  .pass .sign {
    color: var(--c-ok);
  }
  .fail .sign {
    color: var(--c-danger);
  }
  .unknown .sign {
    color: var(--c-muted);
  }
  .found {
    display: block;
  }
  .marks {
    display: inline-flex;
    gap: 2px;
  }
  .marks button {
    min-width: 32px;
    min-height: 32px;
    border: 1px solid var(--c-field-line);
    background: var(--c-surface);
    border-radius: var(--radius-sm, 6px);
    font-weight: 800;
    cursor: pointer;
  }
  .marks .yes.on {
    background: var(--c-ok);
    border-color: var(--c-ok);
    color: #fff;
  }
  .marks .no.on {
    background: var(--c-danger);
    border-color: var(--c-danger);
    color: #fff;
  }
  .small {
    font-size: var(--text-sm);
  }
  .muted {
    color: var(--c-muted);
  }
</style>
