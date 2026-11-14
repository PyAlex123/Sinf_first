<script lang="ts">
  import type { AdminSchool } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../lib/api.js';
  import { t } from '../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../lib/router.svelte.js';
  import Button from '../lib/ui/Button.svelte';
  import Card from '../lib/ui/Card.svelte';
  import Header from '../lib/ui/Header.svelte';
  import Notice from '../lib/ui/Notice.svelte';

  /** Our own area (S2.3): schools are created here and nowhere else. A working tool, not a showcase. */

  let { params: _params }: PageProps = $props();
  let schools = $state<AdminSchool[]>([]);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let name = $state('');
  let city = $state('');
  let adminEmail = $state<Record<string, string>>({});

  async function load(): Promise<void> {
    try {
      schools = (await api.adminSchools()).schools;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.navigate('/teacher/login', { replace: true });
        return;
      }
      error = e instanceof ApiError && e.status === 404 ? t('admin.noAccess') : t('common.error');
    }
  }

  async function create(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    busy = true;
    error = null;
    try {
      await api.createSchool({ name: name.trim(), ...(city.trim() ? { city: city.trim() } : {}) });
      name = '';
      city = '';
      await load();
    } catch {
      error = t('common.error');
    } finally {
      busy = false;
    }
  }

  async function assign(school: AdminSchool): Promise<void> {
    const email = (adminEmail[school.id] ?? '').trim();
    if (!email) return;
    busy = true;
    error = null;
    try {
      await api.assignSchoolAdmin(school.id, email);
      adminEmail = { ...adminEmail, [school.id]: '' };
      await load();
    } catch (e) {
      error =
        e instanceof ApiError && e.code === 'user_not_found'
          ? t('admin.noTeacher')
          : t('common.error');
    } finally {
      busy = false;
    }
  }

  onMount(() => void load());
</script>

<Header back="/teacher" />

<main class="page">
  <Card>
    <h1>{t('admin.title')}</h1>
    {#if error}<Notice kind="error">{error}</Notice>{/if}
    <form onsubmit={create}>
      <label>
        <span>{t('school.name')}</span>
        <input bind:value={name} required minlength="2" maxlength="120" />
      </label>
      <label>
        <span>{t('school.city')}</span>
        <input bind:value={city} maxlength="60" />
      </label>
      <Button type="submit" disabled={busy}>{t('admin.create')}</Button>
    </form>
  </Card>

  <ul class="rows">
    {#each schools as school (school.id)}
      <li>
        <span class="who">
          <b>{school.name}</b>
          {#if school.city}<small class="muted">{school.city}</small>{/if}
          <small class="muted">
            {t('school.members', { count: school.teachers })} ·
            {t('school.classes', { count: school.classes })}
            {#if school.admins.length > 0}· {school.admins.join(', ')}{/if}
          </small>
        </span>
        <span class="assign">
          <input
            type="email"
            placeholder={t('admin.adminEmail')}
            aria-label={t('admin.adminEmail')}
            value={adminEmail[school.id] ?? ''}
            oninput={(e) => (adminEmail = { ...adminEmail, [school.id]: e.currentTarget.value })}
          />
          <Button variant="secondary" size="md" disabled={busy} onclick={() => assign(school)}>
            {t('admin.assign')}
          </Button>
        </span>
      </li>
    {/each}
  </ul>
</main>

<style>
  form {
    display: flex;
    gap: var(--space-3);
    align-items: flex-end;
    flex-wrap: wrap;
    margin-top: var(--space-3);
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
  .rows {
    list-style: none;
    margin: var(--space-4) 0;
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
    flex-wrap: wrap;
  }
  .who {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--c-dark);
  }
  .assign {
    display: flex;
    gap: var(--space-2);
  }
</style>
