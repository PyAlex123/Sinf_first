<script lang="ts">
  import type { Pics, Student } from '@sinf/shared';
  import { api } from '../api.js';
  import { t } from '../i18n/index.svelte.js';
  import Button from './Button.svelte';

  /** Class roster with picture codes and a "new code" button (S1.6). */
  let {
    students,
    pics,
    onChange,
  }: { students: Student[]; pics: Pics; onChange: (student: Student) => void } = $props();
  let busy = $state<string | null>(null);

  async function reissue(s: Student): Promise<void> {
    if (!confirm(t('teacher.code.confirm', { name: `${s.lastName} ${s.firstName}` }))) return;
    busy = s.id;
    try {
      const { student } = await api.reissueCode(s.id);
      onChange(student);
    } finally {
      busy = null;
    }
  }
</script>

<table class="roster">
  <thead>
    <tr>
      <th>№</th>
      <th>{t('teacher.students.title')}</th>
      <th>{t('teacher.code')} <small>({t('teacher.code.order')})</small></th>
      <th></th>
    </tr>
  </thead>
  <tbody>
    {#each students as s (s.id)}
      <tr>
        <td class="n">{s.sortOrder}</td>
        <td class="name">{s.lastName} {s.firstName}</td>
        <td class="code">
          {#each s.code as key, i (i)}
            {#if i > 0}<span class="arrow">→</span>{/if}
            <span class="pic" title={key}>
              {#if s.codeKind === 'pics'}{@html pics[key] ?? ''}{:else}<b>{key}</b>{/if}
            </span>
          {/each}
        </td>
        <td>
          <Button variant="ghost" size="md" disabled={busy === s.id} onclick={() => reissue(s)}>
            {t('teacher.code.reissue')}
          </Button>
        </td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .roster {
    width: 100%;
    border-collapse: collapse;
    background: var(--c-surface);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  th,
  td {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--c-line);
    text-align: left;
    vertical-align: middle;
  }
  th {
    color: var(--c-muted);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .n {
    color: var(--c-muted);
    width: 40px;
  }
  .name {
    font-weight: 600;
    color: var(--c-dark);
  }
  .code {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .pic {
    display: inline-block;
    width: 44px;
    height: 33px;
    border: 1px solid var(--c-line);
    border-radius: 6px;
    overflow: hidden;
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
  }
  .arrow {
    color: var(--c-accent);
    font-weight: 800;
  }
</style>
