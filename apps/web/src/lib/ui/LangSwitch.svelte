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
    border: 1px solid var(--c-line);
    border-radius: 999px;
    overflow: hidden;
    background: var(--c-surface);
  }
  button {
    border: 0;
    background: transparent;
    padding: var(--space-2) var(--space-3);
    color: var(--c-muted);
    min-height: 36px;
  }
  .active {
    background: var(--c-dark);
    color: #fff;
  }
</style>
