<script lang="ts">
  import { i18n, LOCALE_NAMES, t } from '../i18n/index.svelte.js';

  /** `compact` — "UZ RU EN" for a phone's header; the full name stays for screen readers. */
  let { compact = false }: { compact?: boolean } = $props();
</script>

<div class="lang" class:compact role="group" aria-label={t('common.language')}>
  {#each i18n.locales as locale (locale)}
    <button
      type="button"
      class:active={i18n.locale === locale}
      aria-pressed={i18n.locale === locale}
      aria-label={compact ? LOCALE_NAMES[locale] : undefined}
      onclick={() => void i18n.set(locale)}
    >
      {compact ? locale.toUpperCase() : LOCALE_NAMES[locale]}
    </button>
  {/each}
</div>

<style>
  .lang {
    display: inline-flex;
    border: 1px solid var(--c-line-strong);
    border-radius: var(--radius-pill);
    overflow: hidden;
    background: var(--c-surface);
    flex: none;
  }
  button {
    border: 0;
    background: transparent;
    padding: 0 var(--space-3);
    color: var(--c-muted);
    font-weight: 600;
    min-height: var(--control-sm);
  }
  .compact button {
    padding: 0 var(--space-2);
    font-size: var(--text-sm);
  }
  .active {
    background: var(--c-dark);
    color: #fff;
  }
</style>
