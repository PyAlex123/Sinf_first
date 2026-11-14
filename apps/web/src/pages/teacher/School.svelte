<script lang="ts">
  import type { SchoolDetailsResponse } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';

  /** School cabinet (S2.3): requests first, then the teachers and the classes of the school. */

  let { params }: PageProps = $props();
  const schoolId = $derived(params['id'] ?? '');

  let data = $state<SchoolDetailsResponse | null>(null);
  let error = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let editing = $state(false);
  let name = $state('');
  let city = $state('');

  const isAdmin = $derived(data?.role === 'admin');

  async function load(): Promise<void> {
    try {
      data = await api.school(schoolId);
      name = data.school.name;
      city = data.school.city ?? '';
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.navigate('/teacher/login', { replace: true });
        return;
      }
      error = e instanceof ApiError && e.status === 404 ? t('school.notFound') : t('common.error');
    }
  }

  async function run(key: string, action: () => Promise<SchoolDetailsResponse>): Promise<void> {
    busy = key;
    error = null;
    try {
      data = await action();
    } catch (e) {
      error =
        e instanceof ApiError && e.code === 'last_admin'
          ? t('school.lastAdmin')
          : t('common.error');
    } finally {
      busy = null;
    }
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    await run('school', () => api.updateSchool(schoolId, { name, city: city.trim() || null }));
    editing = false;
  }

  onMount(() => void load());
</script>

<Header back="/teacher" />

<main class="page">
  {#if error && !data}
    <Notice kind="error">{error}</Notice>
  {:else if !data}
    <p aria-busy="true">{t('common.loading')}</p>
  {:else}
    <Card>
      {#if editing}
        <form onsubmit={save}>
          <label>
            <span>{t('school.name')}</span>
            <input bind:value={name} required maxlength="120" />
          </label>
          <label>
            <span>{t('school.city')}</span>
            <input bind:value={city} maxlength="60" />
          </label>
          <div class="actions">
            <Button type="submit" disabled={busy === 'school'}>{t('common.save')}</Button>
            <Button variant="ghost" onclick={() => (editing = false)}>{t('common.cancel')}</Button>
          </div>
        </form>
      {:else}
        <h1>{data.school.name}</h1>
        <p class="muted">
          {#if data.school.city}{data.school.city} ·
          {/if}
          {t('school.members', { count: data.members.length })} ·
          {t('school.classes', { count: data.classes.length })}
        </p>
        {#if isAdmin}
          <div class="actions">
            <Button variant="ghost" onclick={() => (editing = true)}>{t('school.edit')}</Button>
          </div>
        {/if}
      {/if}
    </Card>

    {#if error}<Notice kind="error">{error}</Notice>{/if}

    {#if isAdmin && data.requests.length > 0}
      <h2>{t('school.requests')}</h2>
      <ul class="rows">
        {#each data.requests as r (r.userId)}
          <li>
            <span class="who"><b>{r.fullName}</b> <small class="muted">{r.email}</small></span>
            <span class="row-actions">
              <Button
                size="md"
                disabled={busy === r.userId}
                onclick={() =>
                  run(r.userId, () => api.decideRequest(schoolId, r.userId, 'approve'))}
              >
                {t('school.approve')}
              </Button>
              <Button
                variant="ghost"
                size="md"
                disabled={busy === r.userId}
                onclick={() => run(r.userId, () => api.decideRequest(schoolId, r.userId, 'reject'))}
              >
                {t('school.reject')}
              </Button>
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    <h2>{t('school.teachers')}</h2>
    <ul class="rows">
      {#each data.members as m (m.userId)}
        <li>
          <span class="who">
            <b>{m.fullName}</b>
            {#if m.email}<small class="muted">{m.email}</small>{/if}
            {#if m.role === 'admin'}<span class="tag">{t('school.role.admin')}</span>{/if}
          </span>
          {#if isAdmin}
            <span class="row-actions">
              <Button
                variant="ghost"
                size="md"
                disabled={busy === m.userId}
                onclick={() =>
                  run(m.userId, () =>
                    api.setSchoolRole(schoolId, m.userId, m.role === 'admin' ? 'teacher' : 'admin'),
                  )}
              >
                {m.role === 'admin' ? t('school.makeTeacher') : t('school.makeAdmin')}
              </Button>
              <Button
                variant="ghost"
                size="md"
                disabled={busy === m.userId}
                onclick={() => run(m.userId, () => api.removeMember(schoolId, m.userId))}
              >
                {t('school.remove')}
              </Button>
            </span>
          {/if}
        </li>
      {/each}
    </ul>

    <h2>{t('school.classes.title')}</h2>
    {#if data.classes.length === 0}
      <p class="muted">{t('school.noClasses')}</p>
    {:else}
      <ul class="rows">
        {#each data.classes as c (c.id)}
          <li>
            <span class="who">
              <b>{c.name}</b>
              <small class="muted">
                {t('teacher.students', { count: c.studentCount })}
                {#if c.teachers.length > 0}· {c.teachers.join(', ')}{/if}
              </small>
            </span>
            <span class="row-actions">
              <Button variant="ghost" size="md" href={`/teacher/class/${c.id}`}>
                {t('class.manage')}
              </Button>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</main>

<style>
  .rows {
    list-style: none;
    margin: 0 0 var(--space-5);
    padding: 0;
    background: var(--c-surface);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .rows li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--c-line);
  }
  .who {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
    color: var(--c-dark);
  }
  .tag {
    padding: 2px var(--space-2);
    border-radius: 999px;
    background: var(--c-bg-2);
    font-size: var(--text-sm);
    color: var(--c-accent);
    font-weight: 700;
  }
  .row-actions {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
  }
  form {
    display: flex;
    gap: var(--space-3);
    align-items: flex-end;
    flex-wrap: wrap;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-weight: 600;
    color: var(--c-dark);
  }
  input {
    min-height: 44px;
    padding: 0 var(--space-3);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    font-size: var(--text-md);
  }
</style>
