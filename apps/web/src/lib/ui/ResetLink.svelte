<script lang="ts">
  import type { ResetLinkResponse } from '@sinf/shared';
  import { t } from '../i18n/index.svelte.js';
  import Button from './Button.svelte';

  /**
   * A one-time link to set a new password (stage 5, A7), as an administrator hands it to a teacher:
   * to copy into Telegram, with the time it stops working.
   */
  let { link }: { link: ResetLinkResponse } = $props();
  let copied = $state(false);

  const until = $derived(
    new Date(link.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  );

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link.url);
      copied = true;
    } catch {
      // Without the clipboard the link is still there to select.
    }
  }
</script>

<div class="link" data-reset-link>
  <input readonly value={link.url} onfocus={(e) => e.currentTarget.select()} />
  <Button variant="secondary" size="sm" onclick={copy}>
    {copied ? t('invite.copied') : t('invite.copy')}
  </Button>
  <span class="muted small">{t('reset.linkUntil', { time: until })}</span>
</div>

<style>
  .link {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
    margin-top: var(--space-2);
  }
  input {
    flex: 1 1 260px;
    min-height: var(--control-sm);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius);
    background: var(--c-surface);
    color: var(--c-dark);
    font-family: ui-monospace, monospace;
    font-size: var(--text-sm);
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
</style>
