<script lang="ts">
  import {
    guessKtpMapping,
    KTP_FIELDS,
    mapKtpRows,
    MAX_KTP_ROWS,
    type ClassSummary,
    type KtpField,
    type KtpMapping,
    type ParsedTables,
  } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Field from '../../lib/ui/Field.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';

  /**
   * The KTP import wizard (PLAN.md 5.2; stage 4, W10): a file → its table → which row is the
   * header and which column is which (guessed, corrected by the teacher) → the rows as they will
   * be saved, with the skipped ones and why → saved.
   */
  let { params: _params }: PageProps = $props();

  let classes = $state<ClassSummary[]>([]);
  let classId = $state('');
  let title = $state('');
  let fileName = $state('');
  let tables = $state<ParsedTables['tables']>([]);
  let tableIndex = $state(0);
  let header = $state(-1);
  let mapping = $state<KtpMapping>({ number: -1, topic: -1, hours: -1, weekOrDate: -1, note: -1 });
  let reading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  const rows = $derived(tables[tableIndex]?.rows ?? []);
  const width = $derived(rows[0]?.length ?? 0);
  const preview = $derived(mapping.topic >= 0 ? mapKtpRows(rows, header, mapping) : []);
  const kept = $derived(preview.flatMap((p) => (p.row ? [p.row] : [])));
  const skipped = $derived(preview.filter((p) => !p.row).length);
  /** Row choices for the header: the first ones, where a header can be. */
  const headerChoices = $derived(
    rows.slice(0, 10).map((r, i) => ({ i, text: r.filter(Boolean).join(' · ') })),
  );

  function columnLabel(c: number): string {
    const text = header >= 0 ? (rows[header]?.[c] ?? '').trim() : '';
    return text
      ? `${t('ktp.column', { n: c + 1 })}: ${text.slice(0, 30)}`
      : t('ktp.column', { n: c + 1 });
  }

  function pickTable(index: number): void {
    tableIndex = index;
    const guess = guessKtpMapping(tables[index]?.rows ?? []);
    header = guess.header;
    mapping = guess.mapping;
  }

  async function read(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    error = null;
    tables = [];
    if (!/\.(xlsx|docx)$/i.test(file.name)) {
      error = t('ktp.error.type');
      return;
    }
    reading = true;
    try {
      const parsed = await api.parseKtp(file, file.name);
      if (parsed.tables.length === 0) {
        error = t('ktp.error.noTable');
        return;
      }
      fileName = file.name;
      tables = parsed.tables;
      // Of several tables, the biggest is the plan; the others are headings and signatures.
      const biggest = tables.reduce(
        (best, table, i) => (table.rows.length > (tables[best]?.rows.length ?? 0) ? i : best),
        0,
      );
      pickTable(biggest);
    } catch (e) {
      error =
        e instanceof ApiError && e.code === 'file_old_or_protected'
          ? t('ktp.error.old')
          : e instanceof ApiError && e.code === 'edit_on_platform'
            ? t('ktp.onPlatform')
            : e instanceof ApiError && e.status === 413
              ? t('ktp.error.big')
              : t('ktp.error.unreadable');
    } finally {
      reading = false;
    }
  }

  function setField(field: KtpField, value: number): void {
    // One column means one thing: taking it for a field frees it from another.
    const next = { ...mapping };
    for (const f of KTP_FIELDS) if (next[f] === value && value >= 0) next[f] = -1;
    next[field] = value;
    mapping = next;
  }

  async function save(): Promise<void> {
    if (!classId || kept.length === 0) return;
    saving = true;
    error = null;
    try {
      const plan = await api.createKtp({
        classId,
        title: title.trim() || t('ktp.defaultTitle'),
        sourceFile: fileName,
        rows: kept.slice(0, MAX_KTP_ROWS),
      });
      router.navigate(`/teacher/ktp/${plan.id}`, { replace: true });
    } catch (e) {
      error =
        e instanceof ApiError && e.code === 'edit_on_platform'
          ? t('ktp.onPlatform')
          : t('common.error');
    } finally {
      saving = false;
    }
  }

  onMount(async () => {
    try {
      const me = await api.me();
      classes = me.classes;
      const wanted = new URLSearchParams(location.search).get('class');
      classId = classes.find((c) => c.id === wanted)?.id ?? classes[0]?.id ?? '';
    } catch (e) {
      if (e instanceof ApiError && e.status === 401)
        router.navigate('/teacher/login', { replace: true });
      else error = t('common.error');
    }
  });
</script>

<Header back="/teacher/ktp" title={t('ktp.import')} />

<main class="page stack">
  <PageHeader title={t('ktp.import')} subtitle={t('ktp.importHint')} />
  {#if error}<Notice kind="error">{error}</Notice>{/if}

  <Card>
    <div class="grid">
      <Field label={t('ktp.class')}>
        <select bind:value={classId} data-field="ktp-class">
          {#each classes as c (c.id)}
            <option value={c.id}>{c.name}</option>
          {/each}
        </select>
      </Field>
      <Field label={t('ktp.name')}>
        <input
          bind:value={title}
          maxlength="120"
          placeholder={t('ktp.defaultTitle')}
          data-field="ktp-title"
        />
      </Field>
      <Field label={t('ktp.file')} hint={t('ktp.fileHint')}>
        <input
          type="file"
          accept=".xlsx,.docx"
          onchange={read}
          disabled={reading}
          data-field="ktp-file"
        />
      </Field>
    </div>
    {#if reading}<p class="muted">{t('common.loading')}</p>{/if}
  </Card>

  {#if rows.length > 0}
    <Card>
      <h2>{t('ktp.columns')}</h2>
      <div class="grid">
        {#if tables.length > 1}
          <Field label={t('ktp.table')}>
            <select
              value={tableIndex}
              onchange={(e) => pickTable(Number(e.currentTarget.value))}
              data-field="ktp-table"
            >
              {#each tables as table, i (i)}
                <option value={i}
                  >{table.name} ({t('ktp.rows', { count: table.rows.length })})</option
                >
              {/each}
            </select>
          </Field>
        {/if}
        <Field label={t('ktp.header')}>
          <select bind:value={header} data-field="ktp-header">
            <option value={-1}>{t('ktp.noHeader')}</option>
            {#each headerChoices as choice (choice.i)}
              <option value={choice.i}>{choice.i + 1}: {choice.text.slice(0, 60)}</option>
            {/each}
          </select>
        </Field>
        {#each KTP_FIELDS as field (field)}
          <Field label={t(`ktp.field.${field}`)}>
            <select
              value={mapping[field]}
              onchange={(e) => setField(field, Number(e.currentTarget.value))}
              data-map={field}
            >
              <option value={-1}>{field === 'topic' ? t('ktp.choose') : t('ktp.notInFile')}</option>
              {#each Array.from({ length: width }, (_, c) => c) as c (c)}
                <option value={c}>{columnLabel(c)}</option>
              {/each}
            </select>
          </Field>
        {/each}
      </div>
    </Card>

    {#if mapping.topic < 0}
      <Notice kind="warn">{t('ktp.needTopic')}</Notice>
    {:else}
      <Card>
        <div class="summary">
          <h2>{t('ktp.preview')}</h2>
          <span class="muted" data-summary>
            {t('ktp.willSave', { count: kept.length })}
            {#if skipped > 0}· {t('ktp.skipped', { count: skipped })}{/if}
          </span>
        </div>
        {#if kept.length > MAX_KTP_ROWS}
          <Notice kind="warn">{t('ktp.tooMany', { max: MAX_KTP_ROWS })}</Notice>
        {/if}
        <div class="wrap">
          <table>
            <thead>
              <tr>
                <th>{t('ktp.line')}</th>
                {#each KTP_FIELDS as field (field)}<th>{t(`ktp.field.${field}`)}</th>{/each}
              </tr>
            </thead>
            <tbody>
              {#each preview as p (p.line)}
                <tr class:skip={!p.row} class:doubt={p.problem === 'bad_hours'} data-line={p.line}>
                  <td class="muted">{p.line}</td>
                  {#if p.row}
                    <td>{p.row.number}</td>
                    <td class="topic">{p.row.topic}</td>
                    <td>
                      {#if p.problem === 'bad_hours'}
                        <span class="problem">{t('ktp.problem.bad_hours')}</span>
                      {:else}{p.row.hours ?? ''}{/if}
                    </td>
                    <td>{p.row.weekOrDate}</td>
                    <td>{p.row.note}</td>
                  {:else}
                    <td colspan="5" class="problem">
                      {t(`ktp.problem.${p.problem ?? 'no_topic'}`)}: {(rows[p.line - 1] ?? [])
                        .filter(Boolean)
                        .join(' · ')
                        .slice(0, 80)}
                    </td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="actions">
          <Button onclick={save} disabled={saving || kept.length === 0 || !classId}>
            {t('ktp.save', { count: Math.min(kept.length, MAX_KTP_ROWS) })}
          </Button>
        </div>
      </Card>
    {/if}
  {/if}
</main>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--space-3);
  }
  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--text-lg);
  }
  .summary {
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
    flex-wrap: wrap;
  }
  .wrap {
    overflow-x: auto;
    max-height: 60vh;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }
  th,
  td {
    text-align: left;
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--c-line);
    vertical-align: top;
  }
  th {
    position: sticky;
    top: 0;
    background: var(--c-surface);
  }
  .topic {
    min-width: 240px;
  }
  tr.skip td {
    color: var(--c-muted);
  }
  tr.doubt {
    background: var(--c-star);
    background: color-mix(in srgb, var(--c-star) 18%, transparent);
  }
  .problem {
    color: var(--c-danger-strong);
    font-style: italic;
  }
  .actions {
    margin-top: var(--space-3);
    display: flex;
    justify-content: flex-end;
  }
  .muted {
    color: var(--c-muted);
  }
</style>
