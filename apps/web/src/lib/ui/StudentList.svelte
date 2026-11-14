<script lang="ts">
  import type { Pics, Student } from '@sinf/shared';
  import { api } from '../api.js';
  import { t } from '../i18n/index.svelte.js';
  import Button from './Button.svelte';

  /** Class roster with picture codes and a "new code" button (S1.6); editable on the class page (S2.2). */
  let {
    students,
    pics,
    editable = false,
    onChange,
    onRename,
    onRemove,
  }: {
    students: Student[];
    pics: Pics;
    editable?: boolean;
    onChange: (student: Student) => void;
    onRename?: (student: Student, lastName: string, firstName: string) => Promise<void>;
    onRemove?: (student: Student) => Promise<void>;
  } = $props();
  let busy = $state<string | null>(null);
  let editing = $state<string | null>(null);
  let lastName = $state('');
  let firstName = $state('');

  function startEdit(s: Student): void {
    editing = s.id;
    lastName = s.lastName;
    firstName = s.firstName;
  }

  async function saveEdit(s: Student): Promise<void> {
    if (!onRename || !lastName.trim() || !firstName.trim()) return;
    busy = s.id;
    try {
      await onRename(s, lastName.trim(), firstName.trim());
      editing = null;
    } finally {
      busy = null;
    }
  }

  async function remove(s: Student): Promise<void> {
    if (!onRemove) return;
    if (!confirm(t('class.remove.confirm', { name: `${s.lastName} ${s.firstName}` }))) return;
    busy = s.id;
    try {
      await onRemove(s);
    } finally {
      busy = null;
    }
  }

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
        <td class="name">
          {#if editing === s.id}
            <span class="edit">
              <input bind:value={lastName} aria-label={t('class.edit.lastName')} />
              <input bind:value={firstName} aria-label={t('class.edit.firstName')} />
            </span>
          {:else}
            <span class:off={!s.isActive}>{s.lastName} {s.firstName}</span>
            {#if !s.isActive}<small class="muted">{t('class.inactive')}</small>{/if}
          {/if}
        </td>
        <td>
          <div class="code">
            {#each s.code as key, i (i)}
              {#if i > 0}<span class="arrow">→</span>{/if}
              <span class="pic" title={key}>
                {#if s.codeKind === 'pics'}{@html pics[key] ?? ''}{:else}<b>{key}</b>{/if}
              </span>
            {/each}
          </div>
        </td>
        <td>
          <div class="row-actions">
            {#if editing === s.id}
              <Button size="md" disabled={busy === s.id} onclick={() => saveEdit(s)}>
                {t('common.save')}
              </Button>
              <Button variant="ghost" size="md" onclick={() => (editing = null)}>
                {t('common.cancel')}
              </Button>
            {:else}
              <Button variant="ghost" size="md" disabled={busy === s.id} onclick={() => reissue(s)}>
                {t('teacher.code.reissue')}
              </Button>
              {#if editable}
                <Button variant="ghost" size="md" onclick={() => startEdit(s)}>
                  {t('class.edit')}
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  disabled={busy === s.id}
                  onclick={() => remove(s)}
                >
                  {t('class.remove')}
                </Button>
              {/if}
            {/if}
          </div>
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
  .name .off {
    text-decoration: line-through;
    color: var(--c-muted);
  }
  .edit {
    display: flex;
    gap: var(--space-2);
  }
  .edit input {
    min-width: 0;
    min-height: 36px;
    padding: 0 var(--space-2);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    font: inherit;
  }
  .row-actions {
    /* A flex container inside the cell, not the cell itself: a flex `td` drops out of the table row. */
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .code {
    /* Inside the cell, not the cell itself: a flex `td` drops out of the table row. */
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
