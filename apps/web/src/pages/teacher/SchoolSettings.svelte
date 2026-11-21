<script lang="ts">
  import {
    LESSON_APPS,
    MAX_FILE_MB,
    MAX_QUOTA_MB,
    registerDate,
    type LessonApp,
    type RetentionPreview,
    type SchoolSettings,
    type SchoolSettingsResponse,
  } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { i18n, t } from '../../lib/i18n/index.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Field from '../../lib/ui/Field.svelte';
  import Notice from '../../lib/ui/Notice.svelte';

  /**
   * The rules of a school (CLAUDE.md §3.4, §4.9, §4.10; stage 5, A1; ADR-021), set by its
   * administrator once for every class: the child's folder, how long works are kept, the programs
   * of the lessons, how much of a KTP may change.
   */
  let { schoolId }: { schoolId: string } = $props();

  let saved = $state<SchoolSettings | null>(null);
  /** When the next cleaning of old works is, and what it would take today (A4). */
  let retention = $state<RetentionPreview | null>(null);
  let ktpPercent = $state(30);
  let quota = $state(MAX_QUOTA_MB);
  let maxFile = $state(MAX_FILE_MB);
  let keepDay = $state(31);
  let keepMonth = $state(7);
  let apps = $state<LessonApp[]>([...LESSON_APPS]);
  let busy = $state(false);
  let done = $state(false);
  let error = $state<string | null>(null);

  const pad = (n: number): string => String(n).padStart(2, '0');
  /** Month names as after a day ("30 июня"), in the interface language, from the browser. */
  const months = $derived(
    Array.from(
      { length: 12 },
      (_, i) =>
        new Intl.DateTimeFormat(i18n.locale, { day: 'numeric', month: 'long', timeZone: 'UTC' })
          .formatToParts(new Date(Date.UTC(2001, i, 1)))
          .find((p) => p.type === 'month')?.value ?? String(i + 1),
    ),
  );
  const daysInMonth = $derived(new Date(Date.UTC(2001, keepMonth, 0)).getUTCDate());

  function show(res: SchoolSettingsResponse): void {
    const s = res.settings;
    retention = res.retention ?? null;
    saved = s;
    ktpPercent = s.ktpChangePercent;
    quota = s.fileQuotaMb;
    maxFile = s.maxFileMb;
    const [m, d] = s.keepWorksUntil.split('-').map(Number);
    keepMonth = m ?? 7;
    keepDay = d ?? 31;
    apps = [...s.apps];
  }

  function toggle(app: LessonApp, on: boolean): void {
    apps = on
      ? LESSON_APPS.filter((a) => a === app || apps.includes(a))
      : apps.filter((a) => a !== app);
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    done = false;
    error = null;
    const clamp = (v: number, lo: number, hi: number) =>
      Math.max(lo, Math.min(hi, Math.round(Number(v) || lo)));
    try {
      const res = await api.updateSchoolSettings(schoolId, {
        ktpChangePercent: clamp(ktpPercent, 0, 100),
        fileQuotaMb: clamp(quota, 1, MAX_QUOTA_MB),
        maxFileMb: clamp(maxFile, 1, MAX_FILE_MB),
        keepWorksUntil: `${pad(keepMonth)}-${pad(Math.min(keepDay, daysInMonth))}`,
        apps,
      });
      show(res);
      done = true;
    } catch (e) {
      error =
        e instanceof ApiError && e.code === 'edit_on_platform'
          ? t('schoolSettings.onPlatform')
          : t('common.error');
    } finally {
      busy = false;
    }
  }

  onMount(async () => {
    try {
      show(await api.schoolSettings(schoolId));
    } catch {
      error = t('common.error');
    }
  });
</script>

<Card>
  <h2>{t('schoolSettings.title')}</h2>
  <p class="muted small">{t('schoolSettings.hint')}</p>
  {#if error}<Notice kind="error">{error}</Notice>{/if}
  {#if saved}
    <form class="form" onsubmit={save} oninput={() => (done = false)}>
      <fieldset>
        <legend>{t('schoolSettings.files')}</legend>
        <div class="grid">
          <Field
            label={t('schoolSettings.quota')}
            hint={t('schoolSettings.quotaHint', { max: MAX_QUOTA_MB })}
          >
            <input type="number" min="1" max={MAX_QUOTA_MB} bind:value={quota} data-field="quota" />
          </Field>
          <Field
            label={t('schoolSettings.maxFile')}
            hint={t('schoolSettings.maxFileHint', { max: MAX_FILE_MB })}
          >
            <input
              type="number"
              min="1"
              max={MAX_FILE_MB}
              bind:value={maxFile}
              data-field="max-file"
            />
          </Field>
        </div>
      </fieldset>

      <fieldset>
        <legend>{t('schoolSettings.keep')}</legend>
        <p class="muted small">{t('schoolSettings.keepHint')}</p>
        <div class="keep">
          <select bind:value={keepDay} aria-label={t('schoolSettings.day')} data-field="keep-day">
            {#each Array.from({ length: daysInMonth }, (_, i) => i + 1) as d (d)}
              <option value={d}>{d}</option>
            {/each}
          </select>
          <select
            bind:value={keepMonth}
            aria-label={t('schoolSettings.month')}
            data-field="keep-month"
          >
            {#each months as name, i (i)}
              <option value={i + 1}>{name}</option>
            {/each}
          </select>
        </div>
        {#if retention}
          <p class="small" data-retention>
            {t('schoolSettings.next', { date: registerDate(retention.on) })}
            {t('schoolSettings.nextTakes', {
              screenshots: retention.screenshots,
              files: retention.files,
              practice: retention.practiceFiles,
            })}
          </p>
        {/if}
      </fieldset>

      <fieldset>
        <legend>{t('schoolSettings.apps')}</legend>
        <p class="muted small">{t('schoolSettings.appsHint')}</p>
        <div class="apps">
          {#each LESSON_APPS as app (app)}
            <label>
              <input
                type="checkbox"
                checked={apps.includes(app)}
                onchange={(e) => toggle(app, e.currentTarget.checked)}
                data-app={app}
              />
              {t(`apps.${app}`)}
            </label>
          {/each}
        </div>
      </fieldset>

      <fieldset>
        <legend>{t('schoolSettings.ktp')}</legend>
        <div class="grid">
          <Field label={t('school.ktpPercent')} hint={t('school.ktpPercent.hint')}>
            <input
              type="number"
              min="0"
              max="100"
              bind:value={ktpPercent}
              data-field="ktp-percent"
            />
          </Field>
        </div>
      </fieldset>

      <div class="row">
        <Button type="submit" disabled={busy}>{t('common.save')}</Button>
        {#if done}<span class="ok" data-saved>✓ {t('schoolSettings.saved')}</span>{/if}
      </div>
    </form>
  {/if}
</Card>

<style>
  .form {
    display: grid;
    gap: var(--space-4);
    margin-top: var(--space-3);
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
    display: grid;
    gap: var(--space-2);
  }
  legend {
    font-weight: 700;
    margin-bottom: var(--space-2);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--space-3);
  }
  .keep {
    display: flex;
    gap: var(--space-2);
  }
  .keep select {
    min-height: var(--control);
    padding: 0 var(--space-3);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius);
    background: var(--c-surface);
    color: var(--c-dark);
  }
  .apps {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .apps label {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
  }
  .row {
    display: flex;
    gap: var(--space-3);
    align-items: center;
  }
  .ok {
    color: var(--c-ok);
    font-weight: 700;
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
</style>
