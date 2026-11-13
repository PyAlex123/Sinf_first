<script lang="ts">
  import type { JoinLookupResponse, JoinStudent, Pics } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../lib/api.js';
  import { loadPics } from '../lib/content.js';
  import { t } from '../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../lib/router.svelte.js';
  import { saveParticipantToken } from '../lib/stores/session.svelte.js';
  import Button from '../lib/ui/Button.svelte';
  import LangSwitch from '../lib/ui/LangSwitch.svelte';
  import Notice from '../lib/ui/Notice.svelte';

  let { query }: PageProps = $props();

  /** Which student this browser used last for a class — the "demo seating" of STAGE1 S1.7. */
  const SEAT_KEY = (classId: string): string => `sinf.seat.${classId}`;
  const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

  type Step = 'code' | 'name' | 'personal';

  // svelte-ignore state_referenced_locally
  let codeInput = $state((query.get('code') ?? '').replace(/\D/g, '').slice(0, 4));
  let step = $state<Step>('code');
  let lookup = $state<JoinLookupResponse | null>(null);
  let pics = $state<Pics>({});
  let student = $state<JoinStudent | null>(null);
  let entered = $state<string[]>([]);
  let error = $state<string | null>(null);
  let busy = $state(false);

  const codeLength = $derived(lookup?.codeKind === 'digits' ? 4 : 2);
  const choices = $derived(lookup?.codeKind === 'digits' ? DIGITS : (lookup?.codePics ?? []));
  const fullName = (s: JoinStudent): string => `${s.lastName} ${s.firstName}`;

  async function lookupCode(): Promise<void> {
    if (codeInput.length !== 4) return;
    busy = true;
    error = null;
    try {
      const [found, p] = await Promise.all([api.joinLookup(codeInput), loadPics()]);
      lookup = found;
      pics = p;
      // Known student in this browser → straight to the personal code.
      let seated: string | null = null;
      try {
        seated = localStorage.getItem(SEAT_KEY(found.class.id));
      } catch {
        seated = null;
      }
      const known = found.students.find((s) => s.id === seated);
      if (known) {
        student = known;
        step = 'personal';
      } else {
        step = 'name';
      }
    } catch (e) {
      error = e instanceof ApiError && e.status === 404 ? t('join.code.wrong') : t('common.error');
    } finally {
      busy = false;
    }
  }

  function pickStudent(s: JoinStudent): void {
    student = s;
    entered = [];
    error = null;
    step = 'personal';
  }

  function notMe(): void {
    student = null;
    entered = [];
    error = null;
    step = 'name';
  }

  function press(value: string): void {
    if (entered.length >= codeLength) return;
    entered = [...entered, value];
    if (entered.length === codeLength) void submit();
  }

  async function submit(): Promise<void> {
    if (!lookup || !student) return;
    busy = true;
    error = null;
    try {
      const res = await api.join({
        sessionId: lookup.session.id,
        studentId: student.id,
        code: entered,
      });
      saveParticipantToken(res.session.id, res.token);
      try {
        localStorage.setItem(SEAT_KEY(lookup.class.id), student.id);
      } catch {
        // ignore
      }
      router.navigate(`/s/${res.session.id}`);
    } catch (e) {
      entered = [];
      if (e instanceof ApiError && e.code === 'wrong_code') {
        error = t('join.wrongCode', { count: Number(e.details?.['attemptsLeft'] ?? 0) });
      } else if (e instanceof ApiError && e.code === 'locked') {
        error = t('join.locked', { sec: Number(e.details?.['retryAfterSec'] ?? 60) });
      } else {
        error = t('common.error');
      }
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    if (codeInput.length === 4) void lookupCode();
  });
</script>

<main class="join">
  <div class="top"><a class="home" href="/">{t('app.name')}</a><LangSwitch /></div>

  {#if step === 'code'}
    <h1>{t('join.code.title')}</h1>
    <p class="muted">{t('join.code.hint')}</p>
    <form
      class="codeform"
      onsubmit={(e) => {
        e.preventDefault();
        void lookupCode();
      }}
    >
      <input
        class="code"
        inputmode="numeric"
        autocomplete="off"
        maxlength="4"
        placeholder="1234"
        bind:value={codeInput}
        oninput={() => (codeInput = codeInput.replace(/\D/g, '').slice(0, 4))}
      />
      <Button type="submit" size="xl" disabled={codeInput.length !== 4 || busy}>
        {t('join.code.enter')}
      </Button>
    </form>
  {:else if step === 'name' && lookup}
    <h1>{t('join.pickName')}</h1>
    <p class="muted">{lookup.class.name} · {lookup.session.lessonTitle}</p>
    <div class="names">
      {#each lookup.students as s (s.id)}
        <button type="button" onclick={() => pickStudent(s)}>{fullName(s)}</button>
      {/each}
    </div>
  {:else if step === 'personal' && student && lookup}
    <h1>{t('join.hello', { name: student.firstName })}</h1>
    <p class="muted">
      {lookup.codeKind === 'digits' ? t('join.code.digits') : t('join.code.personal')}
    </p>
    <div class="slots">
      {#each Array.from({ length: codeLength }) as _, i (i)}
        <div class="slot" class:filled={!!entered[i]}>
          {#if entered[i]}
            {#if lookup.codeKind === 'digits'}
              <b>{entered[i]}</b>
            {:else}
              {@html pics[entered[i] ?? ''] ?? ''}
            {/if}
          {/if}
        </div>
      {/each}
    </div>
    <div class="choices" class:digits={lookup.codeKind === 'digits'}>
      {#each choices as key (key)}
        <button type="button" class="choice" disabled={busy} onclick={() => press(key)}>
          {#if lookup.codeKind === 'digits'}<b>{key}</b>{:else}{@html pics[key] ?? ''}{/if}
        </button>
      {/each}
    </div>
    <div class="row">
      <Button variant="secondary" onclick={() => (entered = [])} disabled={entered.length === 0}>
        {t('join.clear')}
      </Button>
      <Button variant="ghost" onclick={notMe}>{t('join.notMe')}</Button>
    </div>
  {/if}

  {#if error}
    <div class="err"><Notice kind="error">{error}</Notice></div>
  {/if}
</main>

<style>
  .join {
    min-height: 100vh;
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .top {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-5);
  }
  .home {
    font-weight: 800;
    color: var(--c-dark);
    text-decoration: none;
    font-size: var(--text-lg);
  }
  h1 {
    font-size: var(--text-2xl);
  }
  .muted {
    color: var(--c-muted);
    font-size: var(--text-lg);
  }
  .codeform {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: min(100%, 360px);
    margin-top: var(--space-4);
  }
  .code {
    font-size: 56px;
    font-weight: 800;
    text-align: center;
    letter-spacing: 12px;
    padding: var(--space-3);
    border: 3px solid var(--c-line);
    border-radius: var(--radius-lg);
    color: var(--c-dark);
    background: var(--c-surface);
  }
  .names {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--space-3);
    width: min(100%, 820px);
    margin-top: var(--space-4);
  }
  .names button {
    min-height: 72px;
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--c-dark);
    background: var(--c-surface);
    border: 3px solid var(--c-line);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    padding: var(--space-2) var(--space-3);
  }
  .names button:hover {
    border-color: var(--c-accent);
  }
  .slots {
    display: flex;
    gap: var(--space-3);
    margin: var(--space-4) 0;
  }
  .slot {
    width: 110px;
    height: 84px;
    border: 4px dashed var(--c-line);
    border-radius: var(--radius-lg);
    background: var(--c-surface);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .slot.filled {
    border-style: solid;
    border-color: var(--c-ok);
  }
  .slot :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
  .slot b {
    font-size: 48px;
    color: var(--c-dark);
  }
  .choices {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
    width: min(100%, 560px);
  }
  .choices.digits {
    grid-template-columns: repeat(5, 1fr);
  }
  .choice {
    aspect-ratio: 4 / 3;
    border: 3px solid var(--c-line);
    border-radius: var(--radius-lg);
    background: var(--c-surface);
    box-shadow: var(--shadow);
    padding: 4px;
    overflow: hidden;
  }
  .choice:active {
    border-color: var(--c-accent);
  }
  .choice :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
  .choice b {
    font-size: 40px;
    color: var(--c-dark);
  }
  .row {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-4);
  }
  .err {
    margin-top: var(--space-4);
    width: min(100%, 560px);
  }
</style>
