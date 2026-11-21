<script lang="ts">
  import { isRightAnswer, type QuestionScreen } from '@sinf/shared';
  import { t } from '../../lib/i18n/index.svelte.js';

  /**
   * A question of a teacher's test (PLAN.md 3.5; stage 4, W4). One try: the child answers, sees
   * whether it was right, and goes on; the star (or none) goes to the lesson's results. A test is
   * not a trainer: there is no "try again", and the right answer is not shown to the next desk.
   */
  let {
    screen,
    done,
    frozen = false,
    onAnswer,
  }: {
    screen: QuestionScreen;
    /** Already answered in this lesson (after a reload too). */
    done: boolean;
    frozen?: boolean;
    onAnswer: (stars: number) => void;
  } = $props();

  let chosen = $state<number[]>([]);
  let typed = $state('');
  let result = $state<'right' | 'wrong' | null>(null);

  const answered = $derived(done || result !== null);
  const ready = $derived(screen.mode === 'input' ? typed.trim().length > 0 : chosen.length > 0);

  function toggle(i: number): void {
    if (answered || frozen) return;
    if (screen.mode === 'single') {
      chosen = [i];
      return;
    }
    chosen = chosen.includes(i) ? chosen.filter((c) => c !== i) : [...chosen, i];
  }

  function submit(event?: SubmitEvent): void {
    event?.preventDefault();
    if (answered || frozen || !ready) return;
    const right = isRightAnswer(screen, { chosen, typed });
    result = right ? 'right' : 'wrong';
    onAnswer(right ? 1 : 0);
  }
</script>

<section class="question" data-mode={screen.mode}>
  <p class="num">{t('test.question', { n: screen.n, of: screen.of })}</p>
  <h2>{screen.text}</h2>
  {#if screen.mode === 'multi' && !answered}<p class="hint">{t('test.several')}</p>{/if}

  <form onsubmit={submit}>
    {#if screen.mode === 'input'}
      <input
        class="typed"
        bind:value={typed}
        maxlength="60"
        disabled={answered || frozen}
        placeholder={t('test.typeHere')}
        aria-label={t('test.typeHere')}
        autocomplete="off"
      />
    {:else}
      <div class="options">
        {#each screen.options as option, i (i)}
          <button
            type="button"
            class="opt"
            class:on={chosen.includes(i)}
            aria-pressed={chosen.includes(i)}
            disabled={answered || frozen}
            onclick={() => toggle(i)}
          >
            <span class="box" aria-hidden="true">{screen.mode === 'multi' ? '☐' : '○'}</span>
            {option}
          </button>
        {/each}
      </div>
    {/if}

    {#if result === 'right'}
      <p class="said ok" role="status">{t('test.right')}</p>
    {:else if result === 'wrong'}
      <p class="said no" role="status">{t('test.wrong')}</p>
    {:else if done}
      <p class="said" role="status">{t('test.already')}</p>
    {:else}
      <button type="submit" class="go" disabled={!ready || frozen}>{t('test.answer')}</button>
    {/if}
  </form>
</section>

<style>
  .question {
    max-width: 900px;
    margin: 0 auto;
    padding: var(--space-5) var(--space-4);
    display: grid;
    gap: var(--space-3);
  }
  .num {
    margin: 0;
    color: var(--c-muted);
    font-weight: 700;
  }
  h2 {
    margin: 0;
    font-size: clamp(22px, 3vw, 40px);
    line-height: 1.25;
  }
  .hint {
    margin: 0;
    color: var(--c-muted);
  }
  form {
    display: grid;
    gap: var(--space-3);
  }
  .options {
    display: grid;
    gap: var(--space-2);
  }
  .opt {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--tap);
    padding: var(--space-2) var(--space-4);
    border: 2px solid var(--c-field-line);
    border-radius: var(--radius-lg);
    background: var(--c-surface);
    font: inherit;
    font-size: clamp(18px, 2.2vw, 28px);
    text-align: left;
    cursor: pointer;
  }
  .opt.on {
    border-color: var(--c-accent);
    background: var(--c-accent-soft);
  }
  .opt.on .box {
    color: var(--c-accent);
  }
  .box {
    font-size: 1.1em;
    color: var(--c-muted);
  }
  .typed {
    font: inherit;
    font-size: clamp(20px, 2.4vw, 30px);
    padding: var(--space-2) var(--space-3);
    border: 2px solid var(--c-field-line);
    border-radius: var(--radius-lg);
  }
  .go {
    justify-self: start;
    min-height: var(--tap);
    padding: 0 var(--space-6);
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--c-accent);
    color: #fff;
    font-weight: 800;
    font-size: var(--text-lg);
  }
  .go:disabled {
    opacity: 0.5;
  }
  .said {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 800;
  }
  .said.ok {
    color: var(--c-ok);
  }
  .said.no {
    color: var(--c-danger);
  }
</style>
