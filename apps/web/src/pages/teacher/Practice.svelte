<script lang="ts">
  import {
    CriterionSchema,
    PRACTICE_APPS,
    PRACTICE_FILE_EXTENSIONS,
    PracticeTaskSchema,
    CheckReportSchema,
    type CheckReport,
    type Criterion,
    type PracticeApp,
  } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { checksFor, CHECKS, type CheckSpec, type ParamSpec } from '../../lib/practice-catalog.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Badge from '../../lib/ui/Badge.svelte';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';

  /**
   * A practice task and its reference file (PLAN.md 3.7, stage 3 H13). The teacher picks the
   * program, assembles criteria from ready-made checks, gives points, and checks a correct file: it
   * must pass every automatic criterion. The check runs here in the browser — the same code as in
   * the classroom — and once more on the server; the two must agree.
   *
   * Tasks are kept with the lesson content for now (a lesson is not in the database yet, PLAN.md
   * 3.1): "Copy the task" gives the JSON a lesson file takes.
   */
  let { params: _params }: PageProps = $props();

  interface Row {
    key: number;
    kind: 'auto' | 'manual';
    id: string;
    ru: string;
    uz: string;
    points: number;
    type: string;
    params: Record<string, unknown>;
  }

  let app = $state<PracticeApp>('word');
  let fileName = $state('Документ.docx');
  let rows = $state<Row[]>([]);
  let nextKey = 0;
  let file = $state<File | null>(null);
  let local = $state<CheckReport | null>(null);
  let server = $state<CheckReport | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let copied = $state(false);

  const specs = $derived(checksFor(app));
  const specOf = (type: string): CheckSpec | undefined => CHECKS.find((c) => c.type === type);
  const asText = (v: unknown): string =>
    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';

  function addAuto(type?: string): void {
    const spec = (type ? specOf(type) : undefined) ?? specs[0];
    if (!spec) return;
    nextKey += 1;
    rows = [
      ...rows,
      {
        key: nextKey,
        kind: 'auto',
        id: `c${nextKey}`,
        ru: t(`practice.check.${spec.type}`),
        uz: '',
        points: 1,
        type: spec.type,
        params: { ...spec.example },
      },
    ];
  }

  function addManual(): void {
    nextKey += 1;
    rows = [
      ...rows,
      {
        key: nextKey,
        kind: 'manual',
        id: `m${nextKey}`,
        ru: '',
        uz: '',
        points: 1,
        type: '',
        params: {},
      },
    ];
  }

  /** The sample task "Оформи документ": 5 automatic and 2 manual criteria (PLAN.md 3.7). */
  function sample(): void {
    app = 'word';
    fileName = 'Документ.docx';
    rows = [];
    for (const [type, params] of [
      ['docx.headings', { level: 1, min: 1 }],
      ['docx.font', { family: 'Times New Roman', sizePt: 14 }],
      ['docx.align', { align: 'both', target: 'body' }],
      ['docx.list', { minItems: 3 }],
      ['docx.table', { min: 1, minRows: 3, minCols: 2 }],
    ] as const) {
      addAuto(type);
      const last = rows.at(-1);
      if (last) last.params = { ...params };
    }
    addManual();
    const m1 = rows.at(-1);
    if (m1) m1.ru = t('practice.sample.neat');
    addManual();
    const m2 = rows.at(-1);
    if (m2) m2.ru = t('practice.sample.own');
  }

  function changeApp(next: PracticeApp): void {
    app = next;
    const ext = PRACTICE_FILE_EXTENSIONS[next][0] ?? 'txt';
    fileName = `${fileName.replace(/\.[^.]+$/, '')}.${ext}`;
    // Automatic criteria of another program make no sense any more.
    rows = rows.filter((r) => r.kind === 'manual' || specs.some((s) => s.type === r.type));
    local = null;
    server = null;
  }

  function changeType(row: Row, type: string): void {
    const spec = specOf(type);
    row.type = type;
    row.params = { ...(spec?.example ?? {}) };
    row.ru = t(`practice.check.${type}`);
  }

  function setParam(row: Row, p: ParamSpec, raw: string | boolean): void {
    const next = { ...row.params };
    if (raw === '' && p.optional) delete next[p.key];
    else if (p.kind === 'int') next[p.key] = Math.max(0, Math.round(Number(raw)));
    else if (p.kind === 'number') next[p.key] = Number(raw);
    else if (p.kind === 'numberOrText')
      next[p.key] = raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
    else next[p.key] = raw;
    row.params = next;
  }

  /** The task as data, or the first problem with it. */
  const built = $derived.by(() => {
    const criteria: Criterion[] = [];
    for (const r of rows) {
      const label = { ru: r.ru.trim() || '—', uz: r.uz.trim() || r.ru.trim() || '—' };
      const parsed = CriterionSchema.safeParse(
        r.kind === 'manual'
          ? { id: r.id, kind: 'manual', label, points: r.points }
          : {
              id: r.id,
              kind: 'auto',
              label,
              points: r.points,
              check: { type: r.type, ...r.params },
            },
      );
      if (!parsed.success)
        return {
          ok: false as const,
          problem: `${label.ru}: ${parsed.error.issues[0]?.message ?? ''}`,
        };
      criteria.push(parsed.data);
    }
    const task = PracticeTaskSchema.safeParse({ app, fileName, criteria });
    return task.success
      ? { ok: true as const, task: task.data }
      : { ok: false as const, problem: task.error.issues[0]?.message ?? '' };
  });

  async function check(): Promise<void> {
    if (!file || !built.ok || busy) return;
    busy = true;
    error = null;
    local = null;
    server = null;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // The checkers are loaded only here: the first screen of the site stays small (§3.1).
      const { checkFile } = await import('@sinf/checkers');
      local = checkFile(bytes, file.name, built.task.criteria);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const res = await fetch('/api/practice/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ task: built.task, fileName: file.name, file: btoa(binary) }),
      });
      if (res.status === 401) {
        router.navigate('/teacher/login', { replace: true });
        return;
      }
      if (res.ok) server = CheckReportSchema.parse(await res.json());
      else error = t('practice.serverFailed');
    } catch {
      error = t('common.error');
    } finally {
      busy = false;
    }
  }

  const agree = $derived(
    !!local && !!server && local.results.every((r, i) => server?.results[i]?.outcome === r.outcome),
  );
  const allPass = $derived(
    !!local && local.file === 'ok' && local.results.every((r) => r.outcome === 'pass'),
  );
  const resultOf = (id: string) => local?.results.find((r) => r.id === id);

  async function copyTask(): Promise<void> {
    if (!built.ok) return;
    await navigator.clipboard.writeText(JSON.stringify(built.task, null, 2));
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  onMount(() => {
    void (async () => {
      try {
        await api.me();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401)
          router.navigate('/teacher/login', { replace: true });
      }
    })();
    sample();
  });
</script>

<Header back="/teacher" title={t('practice.title')} />

<main class="page stack">
  <PageHeader title={t('practice.title')} subtitle={t('practice.subtitle')}>
    {#snippet actions()}
      <Button variant="secondary" onclick={sample}>{t('practice.sample')}</Button>
      <Button variant="secondary" disabled={!built.ok} onclick={copyTask}>
        {copied ? t('practice.copied') : t('practice.copy')}
      </Button>
    {/snippet}
  </PageHeader>

  <Card>
    <div class="head">
      <label>
        {t('practice.app')}
        <select value={app} onchange={(e) => changeApp(e.currentTarget.value as PracticeApp)}>
          {#each PRACTICE_APPS.filter((a) => a !== 'paint') as a (a)}
            <option value={a}>{t(`practice.app.${a}`)}</option>
          {/each}
        </select>
      </label>
      <label>
        {t('practice.fileName')}
        <input bind:value={fileName} maxlength="120" />
      </label>
    </div>
  </Card>

  <section class="stack">
    <h2>{t('practice.criteria')}</h2>
    {#each rows as row (row.key)}
      {@const spec = specOf(row.type)}
      {@const result = resultOf(row.id)}
      <div
        class="crit"
        class:pass={result?.outcome === 'pass'}
        class:fail={result?.outcome === 'fail'}
      >
        <div class="line">
          {#if row.kind === 'auto'}
            <select
              value={row.type}
              onchange={(e) => changeType(row, e.currentTarget.value)}
              aria-label={t('practice.check')}
            >
              {#each specs as s (s.type)}
                <option value={s.type}>{t(`practice.check.${s.type}`)}</option>
              {/each}
            </select>
          {:else}
            <Badge tone="info">{t('practice.manual')}</Badge>
          {/if}
          <input
            class="label"
            bind:value={row.ru}
            placeholder={t('practice.label')}
            aria-label={t('practice.label')}
          />
          <label class="pts">
            <input
              type="number"
              min="1"
              max="100"
              bind:value={row.points}
              aria-label={t('practice.points')}
            />
            {t('practice.pointsShort')}
          </label>
          <button
            type="button"
            class="x"
            aria-label={t('class.remove')}
            onclick={() => (rows = rows.filter((r) => r.key !== row.key))}>×</button
          >
        </div>
        {#if spec && spec.params.length > 0}
          <div class="params">
            {#each spec.params as p (p.key)}
              <label>
                <span>{t(`practice.param.${p.key}`)}{p.optional ? '' : ' *'}</span>
                {#if p.kind === 'bool'}
                  <input
                    type="checkbox"
                    checked={row.params[p.key] === true}
                    onchange={(e) => setParam(row, p, e.currentTarget.checked)}
                  />
                {:else if p.kind === 'choice'}
                  <select
                    value={asText(row.params[p.key])}
                    onchange={(e) => setParam(row, p, e.currentTarget.value)}
                  >
                    {#each p.options ?? [] as o (o)}<option value={o}
                        >{t(`practice.option.${o}`)}</option
                      >{/each}
                  </select>
                {:else}
                  <input
                    type={p.kind === 'int' || p.kind === 'number' ? 'number' : 'text'}
                    step={p.kind === 'number' ? '0.1' : '1'}
                    value={asText(row.params[p.key])}
                    oninput={(e) => setParam(row, p, e.currentTarget.value)}
                  />
                {/if}
              </label>
            {/each}
          </div>
        {/if}
        {#if result}
          <p class="result small">
            <b>{t(`practice.outcome.${result.outcome}`)}</b>
            {#if result.found}· {result.found}{/if}
          </p>
        {/if}
      </div>
    {/each}
    <div class="adds">
      <Button variant="secondary" size="sm" onclick={() => addAuto()}
        >{t('practice.addAuto')}</Button
      >
      <Button variant="secondary" size="sm" onclick={addManual}>{t('practice.addManual')}</Button>
    </div>
    {#if !built.ok}<Notice kind="warn">{built.problem}</Notice>{/if}
  </section>

  <Card>
    <h2>{t('practice.reference')}</h2>
    <p class="muted small">{t('practice.reference.hint')}</p>
    <div class="adds">
      <input
        type="file"
        onchange={(e) => (file = e.currentTarget.files?.[0] ?? null)}
        aria-label={t('practice.reference')}
      />
      <Button disabled={!file || !built.ok || busy} onclick={check}
        >{t('practice.check.run')}</Button
      >
    </div>
    {#if error}<Notice kind="error">{error}</Notice>{/if}
    {#if local}
      <div class="verdict">
        {#if local.file !== 'ok'}
          <Notice kind="warn">{t(`practice.file.${local.file}`)}</Notice>
        {:else if allPass}
          <Notice kind="ok">{t('practice.allPass')}</Notice>
        {:else}
          <Notice kind="warn"
            >{t('practice.notAll', { score: local.autoScore, max: local.autoMax })}</Notice
          >
        {/if}
        <p class="muted small">
          {t('practice.time', { ms: Math.round(local.ms) })}
          {#if server}
            · {agree ? t('practice.serverAgrees') : t('practice.serverDiffers')}
          {/if}
        </p>
      </div>
    {/if}
  </Card>
</main>

<style>
  .head,
  .adds {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    align-items: end;
  }
  .head label,
  .params label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--c-muted);
  }
  select,
  input:not([type='checkbox']) {
    font: inherit;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius);
    background: var(--c-surface);
    color: var(--c-dark);
  }
  .crit {
    border: 1px solid var(--c-line);
    border-left: 4px solid var(--c-line-strong);
    border-radius: var(--radius-lg);
    background: var(--c-surface);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .crit.pass {
    border-left-color: var(--c-ok);
  }
  .crit.fail {
    border-left-color: var(--c-danger);
  }
  .line {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
  }
  .label {
    flex: 1 1 220px;
  }
  .pts {
    display: flex;
    gap: var(--space-1);
    align-items: center;
    font-size: var(--text-sm);
  }
  .pts input {
    width: 4.5em;
  }
  .x {
    border: none;
    background: none;
    font-size: var(--text-lg);
    color: var(--c-muted);
    cursor: pointer;
  }
  .params {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .result {
    margin: 0;
  }
  .verdict {
    margin-top: var(--space-3);
  }
</style>
