<script lang="ts">
  import type { InviteInfoResponse } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../lib/api.js';
  import { t } from '../lib/i18n/index.svelte.js';
  import { withNext } from '../lib/next.js';
  import { router, type PageProps } from '../lib/router.svelte.js';
  import Button from '../lib/ui/Button.svelte';
  import Card from '../lib/ui/Card.svelte';
  import Header from '../lib/ui/Header.svelte';
  import Notice from '../lib/ui/Notice.svelte';

  /**
   * An invitation into a school (PLAN.md 2.3; stage 5, A6). A teacher opens the link from the
   * staff's chat: signs in or registers, comes back here, and joins with one button — no request
   * to wait for.
   */
  let { params }: PageProps = $props();
  const token = $derived(params['token'] ?? '');

  let info = $state<InviteInfoResponse | null>(null);
  let signedIn = $state(false);
  let member = $state(false);
  let gone = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const here = $derived(`/invite/${token}`);

  async function join(): Promise<void> {
    busy = true;
    error = null;
    try {
      const res = await api.acceptInvite(token);
      router.navigate(`/school/${res.schoolId}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'invite_gone') gone = true;
      else error = t('common.error');
    } finally {
      busy = false;
    }
  }

  onMount(async () => {
    try {
      info = await api.invite(token);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'invite_gone' || e.status === 400)) gone = true;
      else
        error =
          e instanceof ApiError && e.code === 'edit_on_platform'
            ? t('invite.onPlatform')
            : t('common.error');
      return;
    }
    signedIn = info.visitor !== 'guest';
    member = info.visitor === 'member';
  });
</script>

<Header back="/" />
<main class="page narrow">
  <Card>
    {#if gone}
      <h1>{t('invite.goneTitle')}</h1>
      <p class="muted">{t('invite.gone')}</p>
    {:else if error}
      <Notice kind="error">{error}</Notice>
    {:else if !info}
      <p class="muted" aria-busy="true">{t('common.loading')}</p>
    {:else}
      <h1 data-invite-school>{t('invite.title', { name: info.school.name })}</h1>
      {#if info.school.city}<p class="muted">{info.school.city}</p>{/if}
      {#if member}
        <p>{t('invite.already')}</p>
        <Button href={`/school/${info.school.id}`}>{t('school.open')}</Button>
      {:else if signedIn}
        <p>{t('invite.hint')}</p>
        <Button onclick={join} disabled={busy}>{t('invite.join')}</Button>
      {:else}
        <p>{t('invite.signIn')}</p>
        <div class="row">
          <Button href={withNext('/teacher/login', here)}>{t('login.submit')}</Button>
          <Button variant="secondary" href={withNext('/teacher/register', here)}>
            {t('register.submit')}
          </Button>
        </div>
      {/if}
    {/if}
  </Card>
</main>

<style>
  .row {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin-top: var(--space-3);
  }
  .muted {
    color: var(--c-muted);
  }
</style>
