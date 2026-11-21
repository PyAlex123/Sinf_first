<script lang="ts">
  import type { Device, SchoolClass, SchoolDetailsResponse } from '@sinf/shared';
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
  import SchoolSettings from './SchoolSettings.svelte';

  /**
   * School cabinet (S2.3; stage 5, A5 — PLAN.md 8.1). The administrator has tabs: an overview, the
   * teachers with their requests, the classes and who teaches them, the computers by room, and the
   * school's rules. A plain teacher of the school sees the teachers and the classes.
   */

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

  type Tab = 'overview' | 'teachers' | 'classes' | 'computers' | 'rules';
  const ADMIN_TABS: Tab[] = ['overview', 'teachers', 'classes', 'computers', 'rules'];
  const TEACHER_TABS: Tab[] = ['teachers', 'classes'];
  const tabs = $derived(isAdmin ? ADMIN_TABS : TEACHER_TABS);
  /** Kept in the address (`#computers`), so a link or a reload opens the same tab. */
  let wanted = $state<string>(typeof location === 'undefined' ? '' : location.hash.slice(1));
  const tab = $derived<Tab>(
    (tabs as string[]).includes(wanted) ? (wanted as Tab) : (tabs[0] ?? 'teachers'),
  );
  function openTab(next: Tab): void {
    wanted = next;
    history.replaceState(history.state, '', `#${next}`);
  }

  /** "0.1.10.0" is newer than "0.1.9.0": versions compare by numbers, part by part. */
  function versionCompare(a: string, b: string): number {
    const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0);
    const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  }
  const newest = $derived(
    devices
      .flatMap((d) => (d.appVersion ? [d.appVersion] : []))
      .reduce<string | null>((best, v) => (!best || versionCompare(v, best) > 0 ? v : best), null),
  );
  const isOld = (d: Device): boolean =>
    !!newest && !!d.appVersion && versionCompare(d.appVersion, newest) < 0;
  const isOnline = (d: Device): boolean =>
    d.paired && !!d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < 3 * 60000;
  /** The computers by room, rooms in alphabetical order, those without one last. */
  const rooms = $derived.by((): [string, Device[]][] => {
    const byRoom: Record<string, Device[]> = {};
    for (const d of devices) (byRoom[d.room ?? ''] ??= []).push(d);
    return Object.entries(byRoom).sort(([a], [b]) =>
      a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ru'),
    );
  });
  const studentTotal = $derived(data?.classes.reduce((n, c) => n + c.studentCount, 0) ?? 0);

  /** Who teaches a class: the administrator ticks the school's teachers (A5). */
  let assigning = $state<string | null>(null);
  let assigned = $state<string[]>([]);
  function startAssign(c: SchoolClass): void {
    assigning = c.id;
    assigned = [...c.teacherIds];
  }
  async function saveAssign(c: SchoolClass): Promise<void> {
    await run(c.id, () => api.setClassTeachers(schoolId, c.id, assigned));
    assigning = null;
  }

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
    await run('school', () =>
      api.updateSchool(schoolId, {
        name,
        city: city.trim() || null,
      }),
    );
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

    <div class="tabs" role="tablist">
      {#each tabs as one (one)}
        <button
          type="button"
          role="tab"
          aria-selected={tab === one}
          class:on={tab === one}
          onclick={() => openTab(one)}
          data-tab={one}
        >
          {t(`school.tab.${one}`)}
          {#if one === 'teachers' && isAdmin && data.requests.length > 0}
            <span class="count">{data.requests.length}</span>
          {/if}
        </button>
      {/each}
    </div>

    {#if tab === 'overview'}
      <div class="overview" data-overview>
        <Card>
          <h2>{t('school.tab.teachers')}</h2>
          <p class="big">{data.members.length}</p>
          {#if data.requests.length > 0}
            <button type="button" class="link" onclick={() => openTab('teachers')}>
              {t('school.overview.requests', { count: data.requests.length })}
            </button>
          {/if}
        </Card>
        <Card>
          <h2>{t('school.tab.classes')}</h2>
          <p class="big">{data.classes.length}</p>
          <p class="muted small">{t('teacher.students', { count: studentTotal })}</p>
        </Card>
        <Card>
          <h2>{t('school.tab.computers')}</h2>
          <p class="big" data-online>
            {t('school.overview.online', {
              online: devices.filter(isOnline).length,
              count: devices.length,
            })}
          </p>
          {#if devices.some(isOld)}
            <button type="button" class="link warn" onclick={() => openTab('computers')} data-old>
              {t('school.overview.old', {
                count: devices.filter(isOld).length,
                version: newest ?? '',
              })}
            </button>
          {/if}
        </Card>
      </div>
    {/if}

    <!-- Waiting for an answer comes first: somebody cannot work until it is decided. -->
    {#if tab === 'teachers' && isAdmin && data.requests.length > 0}
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

    {#if tab === 'teachers'}
      <Card>
        <h2>{t('school.teachers')}</h2>
        <Table>
          <tbody>
            {#each data.members as m (m.userId)}
              <tr>
                <td>
                  <span class="who">
                    <b>{m.fullName}</b>
                    {#if m.role === 'admin'}<Badge tone="accent">{t('school.role.admin')}</Badge
                      >{/if}
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
    {/if}

    {#if tab === 'computers' && isAdmin}
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
          {#each rooms as [room, list] (room)}
            <h3 class="room" data-room={room}>
              {room || t('devices.noRoom')}
              <span class="muted small">
                {t('school.overview.online', {
                  online: list.filter(isOnline).length,
                  count: list.length,
                })}
              </span>
            </h3>
            <Table>
              <thead>
                <tr>
                  <th>{t('devices.name')}</th>
                  <th>{t('devices.version')}</th>
                  <th>{t('devices.state')}</th>
                  <th><span class="visually-hidden">{t('common.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {#each list as d (d.id)}
                  <tr data-device={d.name}>
                    <td><b>{d.name}</b></td>
                    <td>
                      <span class="muted">{d.appVersion ?? '—'}</span>
                      {#if isOld(d)}<Badge tone="warn">{t('devices.old')}</Badge>{/if}
                    </td>
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
          {/each}
        {/if}
      </Card>
    {/if}

    {#if tab === 'rules' && isAdmin}
      <!-- The school's rules (stage 5, A1). -->
      <SchoolSettings {schoolId} />
    {/if}

    {#if tab === 'classes'}
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
                  <td data-class={c.name}>
                    <b>{c.name}</b>
                    <div class="muted small">
                      {t('teacher.students', { count: c.studentCount })}
                      {#if c.teachers.length > 0}· {c.teachers.join(', ')}{:else}·
                        <span class="warntext">{t('school.class.noTeacher')}</span>{/if}
                    </div>
                    {#if assigning === c.id}
                      <div class="assign">
                        {#each data.members as m (m.userId)}
                          <label>
                            <input
                              type="checkbox"
                              checked={assigned.includes(m.userId)}
                              onchange={(e) =>
                                (assigned = e.currentTarget.checked
                                  ? [...assigned, m.userId]
                                  : assigned.filter((x) => x !== m.userId))}
                            />
                            {m.fullName}
                          </label>
                        {/each}
                        <Button size="sm" disabled={busy === c.id} onclick={() => saveAssign(c)}>
                          {t('common.save')}
                        </Button>
                        <Button size="sm" variant="ghost" onclick={() => (assigning = null)}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    {/if}
                  </td>
                  <td class="actions">
                    <div>
                      {#if isAdmin && assigning !== c.id}
                        <Button variant="ghost" size="sm" onclick={() => startAssign(c)}>
                          {t('school.class.assign')}
                        </Button>
                      {/if}
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
  .tabs {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
  }
  .tabs button {
    min-height: var(--control-sm);
    padding: 0 var(--space-3);
    border: 1px solid var(--c-line-strong);
    border-radius: var(--radius-pill);
    background: var(--c-surface);
    font-weight: 700;
    color: var(--c-muted);
  }
  .tabs button.on {
    border-color: var(--c-accent);
    background: var(--c-accent-soft);
    color: var(--c-accent-strong);
  }
  .count {
    display: inline-block;
    min-width: 1.4em;
    margin-left: var(--space-1);
    border-radius: var(--radius-pill);
    background: var(--c-accent);
    color: var(--c-surface);
    font-size: var(--text-xs);
    text-align: center;
  }
  .overview {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--space-3);
  }
  .overview h2 {
    margin: 0;
    font-size: var(--text-md);
    color: var(--c-muted);
  }
  .big {
    margin: var(--space-2) 0;
    font-size: var(--text-xl, 1.6rem);
    font-weight: 700;
    color: var(--c-dark);
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--c-accent-strong);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }
  .link.warn,
  .warntext {
    color: var(--c-danger-strong);
  }
  .room {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    margin: var(--space-4) 0 var(--space-2);
    font-size: var(--text-md);
  }
  .assign {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    flex-wrap: wrap;
    margin-top: var(--space-2);
  }
  .assign label {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
  }
</style>
