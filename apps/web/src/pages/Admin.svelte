<script lang="ts">
  import AdminLicense from './AdminLicense.svelte';
  import AdminReports from './AdminReports.svelte';
  import type { AdminSchool } from '@sinf/shared';
  import { onMount } from 'svelte';
  import type { ResetLinkResponse } from '@sinf/shared';
  import { api, ApiError } from '../lib/api.js';
  import ResetLink from '../lib/ui/ResetLink.svelte';
  import { t } from '../lib/i18n/index.svelte.js';
  import { router, type PageProps } from '../lib/router.svelte.js';
  import Button from '../lib/ui/Button.svelte';
  import Card from '../lib/ui/Card.svelte';
  import EmptyState from '../lib/ui/EmptyState.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Header from '../lib/ui/Header.svelte';
  import Notice from '../lib/ui/Notice.svelte';
  import PageHeader from '../lib/ui/PageHeader.svelte';
  import Table from '../lib/ui/Table.svelte';

  /** Our own area (S2.3): schools are created here and nowhere else. A working tool, not a showcase. */

  let { params: _params }: PageProps = $props();
  let schools = $state<AdminSchool[]>([]);
  let error = $state<string | null>(null);
  /** Not a superadmin: show the one line that says so, not a form that cannot work. */
  let denied = $state(false);
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
      denied = e instanceof ApiError && e.status === 404;
      error = denied ? t('admin.noAccess') : t('common.error');
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

  let resetEmail = $state('');
  let resetLink = $state<ResetLinkResponse | null>(null);
  async function giveLink(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = null;
    resetLink = null;
    try {
      resetLink = await api.superadminResetLink(resetEmail.trim());
    } catch (e) {
      error =
        e instanceof ApiError && e.status === 404 ? t('reset.noSuchTeacher') : t('common.error');
    }
  }
</script>

<Header back="/teacher" />

<main class="page stack">
  <PageHeader title={t('admin.title')} />

  {#if error}<Notice kind="error">{error}</Notice>{/if}

  {#if !denied}
    <Card>
      <h2>{t('admin.create')}</h2>
      <form onsubmit={create}>
        <Field label={t('school.name')}>
          <input bind:value={name} required minlength="2" maxlength="120" />
        </Field>
        <Field label={t('school.city')}>
          <input bind:value={city} maxlength="60" />
        </Field>
        <Button type="submit" disabled={busy}>{t('admin.create')}</Button>
      </form>
    </Card>

    <!-- A teacher who forgot the password and has no school admin to ask (A7). -->
    <Card>
      <h2>{t('reset.adminTitle')}</h2>
      <form onsubmit={giveLink}>
        <Field label={t('login.email')}>
          <input type="email" bind:value={resetEmail} required data-field="reset-email" />
        </Field>
        <Button type="submit" variant="secondary" disabled={busy}>{t('reset.giveLink')}</Button>
      </form>
      {#if resetLink}<ResetLink link={resetLink} />{/if}
    </Card>

    <Card>
      <h2>{t('admin.list')}</h2>
      {#if schools.length === 0}
        <EmptyState icon="school" title={t('admin.none')} text={t('admin.none.hint')} />
      {:else}
        <Table>
          <tbody>
            {#each schools as school (school.id)}
              <tr>
                <td>
                  <b>{school.name}</b>
                  <div class="muted small">
                    {#if school.city}{school.city} ·
                    {/if}
                    {t('school.members', { count: school.teachers })} ·
                    {t('school.classes', { count: school.classes })}
                    {#if school.admins.length > 0}· {school.admins.join(', ')}{/if}
                  </div>
                  <!-- What the school has paid for (B2). -->
                  <AdminLicense {school} onchange={() => void load()} />
                </td>
                <td class="actions">
                  <div>
                    <input
                      type="email"
                      placeholder={t('admin.adminEmail')}
                      aria-label={t('admin.adminEmail')}
                      value={adminEmail[school.id] ?? ''}
                      oninput={(e) =>
                        (adminEmail = { ...adminEmail, [school.id]: e.currentTarget.value })}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onclick={() => assign(school)}
                    >
                      {t('admin.assign')}
                    </Button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </Table>
      {/if}
    </Card>
    <!-- Reports about the library (W8). -->
    <AdminReports />
  {/if}
</main>

<style>
  form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
    gap: var(--space-3);
    align-items: end;
    margin-top: var(--space-4);
  }
  .actions input {
    min-height: var(--control-sm);
    width: 220px;
    padding: 0 var(--space-3);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius);
    font: inherit;
  }
  @media (max-width: 700px) {
    form {
      grid-template-columns: minmax(0, 1fr);
    }
    .actions input {
      width: 100%;
    }
  }
</style>
