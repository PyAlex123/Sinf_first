<script lang="ts">
  import type { HomeLookupResponse, HomeMeResponse } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { ApiError } from '../lib/api.js';
  import { home } from '../lib/files.js';
  import { t } from '../lib/i18n/index.svelte.js';
  import type { PageProps } from '../lib/router.svelte.js';
  import Button from '../lib/ui/Button.svelte';
  import FilesPanel from '../lib/ui/FilesPanel.svelte';
  import LangSwitch from '../lib/ui/LangSwitch.svelte';
  import Notice from '../lib/ui/Notice.svelte';

  /**
   * "Мои работы" at home (H12, author's choice): the class code from the card, then one's own name,
   * then one's own code — and the folder. Only for classes with digit codes: two pictures out of six
   * are too easy to guess from home.
   */
  let { params: _params, query: _query }: PageProps = $props();

  const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  const CODE_LENGTH = 4;

  type Step = 'checking' | 'class' | 'name' | 'code' | 'files';
  let step = $state<Step>('checking');
  let classCode = $state('');
  let lookup = $state<HomeLookupResponse | null>(null);
  let studentId = $state<string | null>(null);
  let entered = $state<string[]>([]);
  let me = $state<HomeMeResponse | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);

  const chosen = $derived(lookup?.students.find((s) => s.id === studentId) ?? null);

  onMount(() => {
    void (async () => {
      try {
        me = await home.me();
        step = 'files';
      } catch {
        step = 'class';
        // The QR of the child's card (stage 5, A8): the class code and who it is, ready.
        const query = new URLSearchParams(location.search);
        const card = (query.get('c') ?? '').replace(/\D/g, '').slice(0, 6);
        if (card.length === 6) {
          classCode = card;
          await findClass();
          const who = query.get('s');
          // `findClass` moved on to the names only when the class was found.
          if (lookup && who && lookup.students.some((s) => s.id === who)) {
            studentId = who;
            step = 'code';
          }
        }
      }
    })();
  });

  async function findClass(): Promise<void> {
    if (classCode.length !== 6 || busy) return;
    busy = true;
    error = null;
    try {
      lookup = await home.lookup(classCode);
      step = 'name';
    } catch (e) {
      error =
        e instanceof ApiError && e.code === 'picture_codes'
          ? t('my.pictures')
          : e instanceof ApiError && e.code === 'locked'
            ? t('join.locked', { sec: Number(e.details?.['retryAfterSec'] ?? 600) })
            : e instanceof ApiError && e.status === 404
              ? t('my.wrongClass')
              : t('common.error');
    } finally {
      busy = false;
    }
  }

  async function press(digit: string): Promise<void> {
    if (entered.length >= CODE_LENGTH || busy || !studentId) return;
    entered = [...entered, digit];
    if (entered.length < CODE_LENGTH) return;
    busy = true;
    error = null;
    try {
      me = await home.login(classCode, studentId, entered);
      step = 'files';
    } catch (e) {
      entered = [];
      error =
        e instanceof ApiError && e.code === 'wrong_code'
          ? t('join.wrongCode', { count: Number(e.details?.['attemptsLeft'] ?? 0) })
          : e instanceof ApiError && e.code === 'locked'
            ? t('join.locked', { sec: Number(e.details?.['retryAfterSec'] ?? 120) })
            : t('common.error');
    } finally {
      busy = false;
    }
  }

  async function logout(): Promise<void> {
    await home.logout();
    me = null;
    entered = [];
    studentId = null;
    step = 'class';
  }
</script>

<main class="my">
  <div class="top">
    <a class="home" href="/">{t('app.name')}</a>
    <LangSwitch />
  </div>

  {#if step === 'checking'}
    <p class="muted" aria-busy="true">{t('common.loading')}</p>
  {:else if step === 'files' && me}
    <div class="head">
      <div>
        <h1>{t('my.title')}</h1>
        <p class="muted">{me.student.name} · {me.student.className}</p>
      </div>
      <Button variant="secondary" size="sm" onclick={logout}>{t('my.logout')}</Button>
    </div>
    <FilesPanel access={{ kind: 'home' }} />
  {:else if step === 'class'}
    <h1>{t('my.title')}</h1>
    <p class="muted">{t('my.classCode.hint')}</p>
    <form
      class="codeform"
      onsubmit={(e) => {
        e.preventDefault();
        void findClass();
      }}
    >
      <input
        class="code"
        inputmode="numeric"
        autocomplete="off"
        maxlength="6"
        placeholder="123456"
        aria-label={t('my.classCode')}
        bind:value={classCode}
        oninput={() => (classCode = classCode.replace(/\D/g, '').slice(0, 6))}
      />
      <Button type="submit" size="lg" disabled={classCode.length !== 6 || busy}>
        {t('join.code.enter')}
      </Button>
    </form>
  {:else if step === 'name' && lookup}
    <h1>{t('join.pickName')}</h1>
    <p class="muted">{lookup.class.name}</p>
    <div class="names">
      {#each lookup.students as s (s.id)}
        <button
          type="button"
          onclick={() => {
            studentId = s.id;
            entered = [];
            error = null;
            step = 'code';
          }}>{s.lastName} {s.firstName}</button
        >
      {/each}
    </div>
  {:else if step === 'code' && chosen}
    <h1>{t('join.hello', { name: chosen.firstName })}</h1>
    <p class="muted">{t('join.code.digits')}</p>
    <div class="slots">
      {#each Array.from({ length: CODE_LENGTH }) as _, i (i)}
        <div class="slot" class:filled={!!entered[i]}>
          {#if entered[i]}<b>•</b>{/if}
        </div>
      {/each}
    </div>
    <div class="digits">
      {#each DIGITS as d (d)}
        <button type="button" class="digit" disabled={busy} onclick={() => press(d)}>{d}</button>
      {/each}
    </div>
    <Button variant="ghost" onclick={() => (step = 'name')}>{t('join.notMe')}</Button>
  {/if}

  {#if error}
    <div class="err"><Notice kind="error">{error}</Notice></div>
  {/if}
</main>

<style>
  .my {
    min-height: 100vh;
    max-width: 760px;
    margin: 0 auto;
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .home {
    font-weight: 800;
    color: var(--c-dark);
    text-decoration: none;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-3);
  }
  h1 {
    margin: 0;
  }
  .codeform {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .code {
    font-size: var(--text-xl);
    letter-spacing: 0.2em;
    width: 9ch;
    padding: var(--space-2) var(--space-3);
    border: 2px solid var(--c-field-line);
    border-radius: var(--radius);
  }
  .names {
    display: grid;
    gap: var(--space-2);
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  }
  .names button,
  .digit {
    padding: var(--space-3);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius-lg);
    background: var(--c-surface);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .slots {
    display: flex;
    gap: var(--space-2);
  }
  .slot {
    width: 48px;
    height: 56px;
    border: 2px solid var(--c-field-line);
    border-radius: var(--radius);
    display: grid;
    place-items: center;
    font-size: var(--text-xl);
  }
  .slot.filled {
    border-color: var(--c-dark);
  }
  .digits {
    display: grid;
    grid-template-columns: repeat(5, 64px);
    gap: var(--space-2);
  }
  .digit {
    font-size: var(--text-xl);
    height: 64px;
  }
</style>
