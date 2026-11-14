<script lang="ts">
  import type { Device, SchoolDetailsResponse } from '@sinf/shared';
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
  let devices = $state<Device[]>([]);
  let deviceName = $state('');
  let deviceRoom = $state('');
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
      devices = (await api.devices(schoolId)).devices;
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

  /** "на связи" while the machine reported in during the last few minutes. */
  function seen(device: Device): string {
    if (!device.paired) return t('devices.waiting');
    if (!device.lastSeenAt) return t('devices.never');
    const minutes = Math.round((Date.now() - Date.parse(device.lastSeenAt)) / 60000);
    if (minutes < 3) return t('devices.online');
    if (minutes < 60) return t('devices.minutesAgo', { count: minutes });
    const hours = Math.round(minutes / 60);
    return hours < 24
      ? t('devices.hoursAgo', { count: hours })
      : t('devices.daysAgo', { count: Math.round(hours / 24) });
  }

  async function addDevice(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!deviceName.trim()) return;
    busy = 'device';
    error = null;
    try {
      const { device } = await api.addDevice(schoolId, {
        name: deviceName.trim(),
        role: 'teacher',
        ...(deviceRoom.trim() ? { room: deviceRoom.trim() } : {}),
      });
      devices = [...devices, device];
      deviceName = '';
      deviceRoom = '';
    } catch {
      error = t('common.error');
    } finally {
      busy = null;
    }
  }

  async function newCode(device: Device): Promise<void> {
    if (device.paired && !confirm(t('devices.recodeConfirm', { name: device.name }))) return;
    busy = device.id;
    try {
      const res = await api.newDeviceCode(device.id);
      devices = devices.map((d) => (d.id === device.id ? res.device : d));
    } finally {
      busy = null;
    }
  }

  async function removeDevice(device: Device): Promise<void> {
    if (!confirm(t('devices.removeConfirm', { name: device.name }))) return;
    busy = device.id;
    try {
      devices = (await api.removeDevice(device.id)).devices;
    } finally {
      busy = null;
    }
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

    {#if isAdmin}
      <h2>{t('devices.title')}</h2>
      <p class="muted">{t('devices.hint')}</p>
      <form class="inline" onsubmit={addDevice}>
        <label>
          <span>{t('devices.name')}</span>
          <input bind:value={deviceName} maxlength="40" placeholder="ПК-05" />
        </label>
        <label>
          <span>{t('devices.room')}</span>
          <input bind:value={deviceRoom} maxlength="40" placeholder="Кабинет 204" />
        </label>
        <Button type="submit" disabled={busy === 'device'}>{t('devices.add')}</Button>
      </form>
      {#if devices.length === 0}
        <p class="muted">{t('devices.none')}</p>
      {:else}
        <ul class="rows">
          {#each devices as d (d.id)}
            <li>
              <span class="who">
                <b>{d.name}</b>
                {#if d.room}<small class="muted">{d.room}</small>{/if}
                <small class="muted">
                  {seen(d)}
                  {#if d.appVersion}· {d.appVersion}{/if}
                </small>
              </span>
              <span class="row-actions">
                {#if d.pairingCode}
                  <code class="pair">{d.pairingCode}</code>
                {/if}
                <Button
                  variant="ghost"
                  size="md"
                  disabled={busy === d.id}
                  onclick={() => newCode(d)}
                >
                  {d.paired ? t('devices.recode') : t('devices.newCode')}
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  disabled={busy === d.id}
                  onclick={() => removeDevice(d)}
                >
                  {t('school.remove')}
                </Button>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}

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
  .inline {
    display: flex;
    gap: var(--space-3);
    align-items: flex-end;
    flex-wrap: wrap;
    margin-bottom: var(--space-3);
  }
  .pair {
    padding: 4px var(--space-2);
    border-radius: var(--radius);
    background: var(--c-bg-2);
    font-size: var(--text-md);
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--c-dark);
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
