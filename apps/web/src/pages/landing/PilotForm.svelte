<script lang="ts">
  import { api, ApiError } from '../../lib/api.js';
  import { i18n, t } from '../../lib/i18n/index.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Field from '../../lib/ui/Field.svelte';
  import Notice from '../../lib/ui/Notice.svelte';

  /**
   * A school asks for a pilot (PLAN.md 8.4; B10; ADR-026). The superadmin sees it in /admin. The
   * "website" field is a trap for robots: hidden from people and from screen readers.
   */
  let school = $state('');
  let city = $state('');
  let name = $state('');
  let contact = $state('');
  let classes = $state('');
  let comment = $state('');
  let website = $state('');
  let busy = $state(false);
  let sent = $state(false);
  let error = $state<string | null>(null);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = null;
    busy = true;
    const count = Number.parseInt(classes, 10);
    try {
      await api.sendPilotRequest({
        school,
        city,
        name,
        contact,
        classes: Number.isFinite(count) && count > 0 ? count : null,
        comment,
        locale: i18n.locale,
        website,
      });
      sent = true;
    } catch (e) {
      error = e instanceof ApiError && e.status === 429 ? t('pilot.tooMany') : t('common.error');
    } finally {
      busy = false;
    }
  }

  function again(): void {
    school = city = name = contact = classes = comment = '';
    sent = false;
  }
</script>

{#if sent}
  <div class="done" data-pilot="sent">
    <Notice kind="ok">{t('pilot.sent')}</Notice>
    <Button variant="ghost" onclick={again}>{t('pilot.again')}</Button>
  </div>
{:else}
  <form class="form" onsubmit={submit} data-pilot="form">
    <div class="pair">
      <Field label={t('pilot.school')}>
        <input bind:value={school} required maxlength="160" data-field="school" />
      </Field>
      <Field label={t('pilot.city')}>
        <input bind:value={city} required maxlength="80" data-field="city" />
      </Field>
    </div>
    <div class="pair">
      <Field label={t('pilot.name')}>
        <input bind:value={name} required maxlength="120" autocomplete="name" data-field="name" />
      </Field>
      <Field label={t('pilot.contact')}>
        <input bind:value={contact} required maxlength="120" data-field="contact" />
      </Field>
    </div>
    <Field label={t('pilot.classes')}>
      <input
        bind:value={classes}
        type="number"
        min="1"
        max="200"
        inputmode="numeric"
        class="narrow"
        data-field="classes"
      />
    </Field>
    <Field label={t('pilot.comment')}>
      <textarea bind:value={comment} rows="3" maxlength="1000" data-field="comment"></textarea>
    </Field>
    <label class="trap" aria-hidden="true">
      Website
      <input bind:value={website} tabindex="-1" autocomplete="off" />
    </label>
    {#if error}<Notice kind="error">{error}</Notice>{/if}
    <div class="actions">
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? t('pilot.sending') : t('pilot.submit')}
      </Button>
      <p class="privacy">{t('pilot.privacy')}</p>
    </div>
  </form>
{/if}

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
  }
  .narrow {
    max-width: 160px;
  }
  .trap {
    position: absolute;
    left: -10000px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
  }
  .privacy {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--c-muted);
    flex: 1 1 220px;
  }
  .done {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
  }
  @media (max-width: 640px) {
    .pair {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
