<script lang="ts">
  import type { ClassDetailsResponse, Pics } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { loadPics } from '../../lib/content.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';

  let { params }: PageProps = $props();
  const classId = $derived(params['id'] ?? '');
  let details = $state<ClassDetailsResponse | null>(null);
  let pics = $state<Pics>({});
  let error = $state<string | null>(null);
  const site = $derived(typeof location === 'undefined' ? '' : location.host);

  onMount(() => {
    void (async () => {
      try {
        const [d, p] = await Promise.all([api.classDetails(classId), loadPics()]);
        details = d;
        pics = p;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.navigate('/teacher/login', { replace: true });
          return;
        }
        error = e instanceof Error ? e.message : t('common.error');
      }
    })();
  });
</script>

<div class="no-print">
  <Header back="/teacher" title={t('cards.title')}>
    <Button onclick={() => window.print()}>{t('cards.print')}</Button>
  </Header>
  <p class="page hint">{t('cards.perPage')}</p>
</div>

{#if error}
  <main class="page"><Notice kind="error">{error}</Notice></main>
{:else if !details}
  <main class="page" aria-busy="true">{t('common.loading')}</main>
{:else}
  <main class="sheet">
    {#each details.students as s (s.id)}
      <article class="card">
        <div class="cls">{details.class.name} · {t('app.name')}</div>
        <div class="name">{s.lastName} {s.firstName}</div>
        <div class="code">
          {#each s.code as key, i (i)}
            {#if i > 0}<span class="arrow">→</span>{/if}
            <span class="pic">
              {#if s.codeKind === 'pics'}{@html pics[key] ?? ''}{:else}<b>{key}</b>{/if}
            </span>
          {/each}
        </div>
        <div class="foot">
          <span>{t('cards.hint')}</span>
          <span>{t('cards.site')}: {site}</span>
        </div>
      </article>
    {/each}
  </main>
{/if}

<style>
  .hint {
    color: var(--c-muted);
    padding-top: var(--space-3);
    padding-bottom: 0;
  }
  .sheet {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6mm;
    max-width: 190mm;
    margin: 0 auto;
    padding: var(--space-4);
  }
  .card {
    height: 62mm;
    border: 1px dashed #9aa3ad;
    border-radius: 4mm;
    padding: 4mm 5mm;
    background: #fff;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    break-inside: avoid;
    page-break-inside: avoid;
    color: #13233a;
  }
  .cls {
    font-size: 10pt;
    color: #5e6878;
  }
  .name {
    font-size: 16pt;
    font-weight: 800;
    line-height: 1.1;
  }
  .code {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3mm;
  }
  .pic {
    display: inline-block;
    width: 30mm;
    height: 22mm;
    border: 1px solid #d9dde3;
    border-radius: 3mm;
    overflow: hidden;
    background: #fff;
  }
  .pic :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
  .pic b {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    font-size: 28pt;
  }
  .arrow {
    font-size: 18pt;
    color: #b04a12;
    font-weight: 800;
  }
  .foot {
    display: flex;
    justify-content: space-between;
    font-size: 8pt;
    color: #5e6878;
  }
  @media print {
    @page {
      size: A4 portrait;
      margin: 8mm;
    }
    :global(body) {
      background: #fff;
    }
    .no-print {
      display: none;
    }
    .sheet {
      max-width: none;
      padding: 0;
      gap: 4mm;
    }
    .card {
      height: 64mm;
    }
  }
</style>
