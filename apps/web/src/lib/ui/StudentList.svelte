<script lang="ts">
  import type { Pics, Student } from '@sinf/shared';
  import { api } from '../api.js';
  import { t } from '../i18n/index.svelte.js';
  import Badge from './Badge.svelte';
  import Button from './Button.svelte';
  import Table from './Table.svelte';

  /** Class roster with picture codes and a "new code" button (S1.6); editable on the class page (S2.2). */
  let {
    students,
    pics,
    editable = false,
    onChange,
    onRename,
    onRemove,
    filesLink = false,
  }: {
    students: Student[];
    pics: Pics;
    editable?: boolean;
    onChange: (student: Student) => void;
    onRename?: (student: Student, lastName: string, firstName: string) => Promise<void>;
    onRemove?: (student: Student) => Promise<void>;
    /** A link to the child's "Мои работы" (H12). */
    filesLink?: boolean;
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

<div class="roster">
  <Table>
    <thead>
      <tr>
        <th>№</th>
        <th>{t('teacher.students.title')}</th>
        <th>{t('teacher.code')} <span class="order">({t('teacher.code.order')})</span></th>
        <th><span class="visually-hidden">{t('common.actions')}</span></th>
      </tr>
    </thead>
    <tbody>
      {#each students as s (s.id)}
        <tr>
          <td class="num">{s.sortOrder}</td>
          <td class="name">
            {#if editing === s.id}
              <span class="edit">
                <input bind:value={lastName} aria-label={t('class.edit.lastName')} />
                <input bind:value={firstName} aria-label={t('class.edit.firstName')} />
              </span>
            {:else}
              <span class:off={!s.isActive}>{s.lastName} {s.firstName}</span>
              {#if !s.isActive}<Badge>{t('class.inactive')}</Badge>{/if}
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
          <td class="actions">
            <div>
              {#if editing === s.id}
                <Button size="sm" disabled={busy === s.id} onclick={() => saveEdit(s)}>
                  {t('common.save')}
                </Button>
                <Button variant="ghost" size="sm" onclick={() => (editing = null)}>
                  {t('common.cancel')}
                </Button>
              {:else}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy === s.id}
                  onclick={() => reissue(s)}
                >
                  {t('teacher.code.reissue')}
                </Button>
                {#if filesLink}
                  <Button variant="ghost" size="sm" href={`/teacher/student/${s.id}/files`}>
                    {t('files.title')}
                  </Button>
                {/if}
                {#if editable}
                  <Button variant="ghost" size="sm" onclick={() => startEdit(s)}>
                    {t('class.edit')}
                  </Button>
                  <Button
                    variant="danger-ghost"
                    size="sm"
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
  </Table>
</div>

<style>
  .roster {
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    padding: var(--space-3) var(--space-4);
  }
  .order {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
  }
  .name {
    font-weight: 600;
  }
  /* The name column takes the slack; number, code and actions stay as wide as their content. */
  .roster :global(td:not(.name)),
  .roster :global(th:not(:nth-child(2))) {
    width: 1%;
    white-space: nowrap;
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
    min-height: var(--control-sm);
    padding: 0 var(--space-2);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius);
    font: inherit;
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
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--c-surface);
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
    color: var(--c-line-strong);
    font-weight: 800;
  }
</style>
