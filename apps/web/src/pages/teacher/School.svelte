<script lang="ts">
  import type { Device, SchoolDetailsResponse } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Badge from '../../lib/ui/Badge.svelte';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import EmptyState from '../../lib/ui/EmptyState.svelte';
  import Field from '../../lib/ui/Field.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';
  import Table from '../../lib/ui/Table.svelte';

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

  /** Green only while the computer is actually answering; waiting for its code is not "online". */
  function seenTone(device: Device): 'ok' | 'warn' | 'neutral' {
    if (!device.paired) return 'warn';
    if (!device.lastSeenAt) return 'neutral';
    return Date.now() - Date.parse(device.lastSeenAt) < 3 * 60000 ? 'ok' : 'neutral';
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

<main class="page stack">
  {#if error && !data}
    <Notice kind="error">{error}</Notice>
  {:else if !data}
    <p aria-busy="true" class="muted">{t('common.loading')}</p>
  {:else if editing}
    <Card>
      <h1>{t('school.edit')}</h1>
      <form class="edit" onsubmit={save}>
        <Field label={t('school.name')}>
          <input bind:value={name} required maxlength="120" />
        </Field>
        <Field label={t('school.city')}>
          <input bind:value={city} maxlength="60" />
        </Field>
        <div class="row">
          <Button type="submit" disabled={busy === 'school'}>{t('common.save')}</Button>
          <Button variant="ghost" onclick={() => (editing = false)}>{t('common.cancel')}</Button>
        </div>
      </form>
    </Card>
  {:else}
    <PageHeader
      title={data.school.name}
      subtitle={[
        data.school.city,
        t('school.members', { count: data.members.length }),
        t('school.classes', { count: data.classes.length }),
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      {#snippet actions()}
        {#if isAdmin}
          <Button variant="secondary" size="sm" onclick={() => (editing = true)}>
            {t('school.edit')}
          </Button>
        {/if}
      {/snippet}
    </PageHeader>
  {/if}

  {#if data && !editing}
    {#if error}<Notice kind="error">{error}</Notice>{/if}

    <!-- Waiting for an answer comes first: somebody cannot work until it is decided. -->
    {#if isAdmin && data.requests.length > 0}
      <Card accent>
        <h2>{t('school.requests')}</h2>
        <Table>
          <tbody>
            {#each data.requests as r (r.userId)}
              <tr>
                <td>
                  <b>{r.fullName}</b>
                  <div class="muted small">{r.email}</div>
                </td>
                <td class="actions">
                  <div>
                    <Button
                      size="sm"
                      disabled={busy === r.userId}
                      onclick={() =>
                        run(r.userId, () => api.decideRequest(schoolId, r.userId, 'approve'))}
                    >
                      {t('school.approve')}
                    </Button>
                    <Button
                      variant="danger-ghost"
                      size="sm"
                      disabled={busy === r.userId}
                      onclick={() =>
                        run(r.userId, () => api.decideRequest(schoolId, r.userId, 'reject'))}
                    >
                      {t('school.reject')}
                    </Button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </Table>
      </Card>
    {/if}

    <Card>
      <h2>{t('school.teachers')}</h2>
      <Table>
        <tbody>
          {#each data.members as m (m.userId)}
            <tr>
              <td>
                <span class="who">
                  <b>{m.fullName}</b>
                  {#if m.role === 'admin'}<Badge tone="accent">{t('school.role.admin')}</Badge>{/if}
                </span>
                {#if m.email}<div class="muted small">{m.email}</div>{/if}
              </td>
              {#if isAdmin}
                <td class="actions">
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy === m.userId}
                      onclick={() =>
                        run(m.userId, () =>
                          api.setSchoolRole(
                            schoolId,
                            m.userId,
                            m.role === 'admin' ? 'teacher' : 'admin',
                          ),
                        )}
                    >
                      {m.role === 'admin' ? t('school.makeTeacher') : t('school.makeAdmin')}
                    </Button>
                    <Button
                      variant="danger-ghost"
                      size="sm"
                      disabled={busy === m.userId}
                      onclick={() => run(m.userId, () => api.removeMember(schoolId, m.userId))}
                    >
                      {t('school.remove')}
                    </Button>
                  </div>
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </Table>
    </Card>

    {#if isAdmin}
      <Card>
        <h2>{t('devices.title')}</h2>
        <p class="muted small">{t('devices.hint')}</p>
        <form class="add" onsubmit={addDevice}>
          <Field label={t('devices.name')}>
            <input bind:value={deviceName} maxlength="40" placeholder="ПК-05" />
          </Field>
          <Field label={t('devices.room')}>
            <input bind:value={deviceRoom} maxlength="40" placeholder="Кабинет 204" />
          </Field>
          <Button type="submit" disabled={busy === 'device'}>{t('devices.add')}</Button>
        </form>
        {#if devices.length === 0}
          <EmptyState icon="pc" title={t('devices.none')} text={t('devices.none.hint')} />
        {:else}
          <Table>
            <thead>
              <tr>
                <th>{t('devices.name')}</th>
                <th>{t('devices.room')}</th>
                <th>{t('devices.state')}</th>
                <th><span class="visually-hidden">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {#each devices as d (d.id)}
                <tr>
                  <td>
                    <b>{d.name}</b>
                    {#if d.appVersion}<div class="muted small">{d.appVersion}</div>{/if}
                  </td>
                  <td class="muted">{d.room ?? '—'}</td>
                  <td>
                    <Badge tone={seenTone(d)}>{seen(d)}</Badge>
                    {#if d.pairingCode}<code class="pair">{d.pairingCode}</code>{/if}
                  </td>
                  <td class="actions">
                    <div>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === d.id}
                        onclick={() => newCode(d)}
                      >
                        {d.paired ? t('devices.recode') : t('devices.newCode')}
                      </Button>
                      <Button
                        variant="danger-ghost"
                        size="sm"
                        disabled={busy === d.id}
                        onclick={() => removeDevice(d)}
                      >
                        {t('devices.remove')}
                      </Button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </Table>
        {/if}
      </Card>
    {/if}

    <Card>
      <h2>{t('school.classes.title')}</h2>
      {#if data.classes.length === 0}
        <EmptyState
          icon="student"
          title={t('school.noClasses')}
          text={t('school.noClasses.hint')}
        />
      {:else}
        <Table>
          <tbody>
            {#each data.classes as c (c.id)}
              <tr>
                <td>
                  <b>{c.name}</b>
                  <div class="muted small">
                    {t('teacher.students', { count: c.studentCount })}
                    {#if c.teachers.length > 0}· {c.teachers.join(', ')}{/if}
                  </div>
                </td>
                <td class="actions">
                  <div>
                    <Button variant="ghost" size="sm" href={`/teacher/class/${c.id}`}>
                      {t('class.manage')}
                    </Button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </Table>
      {/if}
    </Card>
  {/if}
</main>

<style>
  .who {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .edit {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: var(--page-narrow);
    margin-top: var(--space-4);
  }
  /* Two fields and the button on one line, wrapping on a phone. */
  .add {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
    gap: var(--space-3);
    align-items: end;
    margin: var(--space-4) 0;
  }
  .pair {
    display: inline-block;
    margin-left: var(--space-2);
    padding: 2px var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--c-bg-2);
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--c-dark);
  }
  @media (max-width: 700px) {
    .add {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
