<script lang="ts">
  import type { Pics } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { t } from '../lib/i18n/index.svelte.js';
  import type { WinInfo } from './lib/types.js';

  let { info, pics, onClose }: { info: WinInfo; pics: Pics; onClose: () => void } = $props();
  let button = $state<HTMLButtonElement | null>(null);
  const pic = $derived(info.picKey ? pics[info.picKey] : undefined);

  onMount(() => button?.focus());
</script>

<div class="win" role="dialog" aria-modal="true" aria-label={t('player.well')}>
  <div class="box">
    <div class="big">{t('player.well')}</div>
    <div class="st">{'★'.repeat(info.stars)}</div>
    {#if pic}{@html pic}{/if}
    {#if info.message}<div class="msg">{info.message}</div>{/if}
    <button class="go" type="button" bind:this={button} onclick={onClose}
      >{t('common.next')} →</button
    >
  </div>
</div>
