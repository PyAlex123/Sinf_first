<script lang="ts">
  import { i18n, LOCALE_NAMES, t } from '../i18n/index.svelte.js';
</script>

<div class="lang" role="group" aria-label={t('common.language')}>
  {#each i18n.locales as locale (locale)}
    <button
      type="button"
      class:active={i18n.locale === locale}
      aria-pressed={i18n.locale === locale}
      onclick={() => i18n.set(locale)}
    >
      {LOCALE_NAMES[locale]}
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
  .active {
    background: var(--c-dark);
    color: #fff;
  }
</style>
