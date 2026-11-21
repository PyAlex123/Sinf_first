<script lang="ts">
  import { registerDate, type EmaktabReminder } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import Notice from '../../lib/ui/Notice.svelte';

  /**
   * On the teacher's home page (PLAN.md 5.4; W12): grades not yet moved to eMaktab while it still
   * takes them, soonest first. Nothing shows when nothing waits.
   */
  let reminders = $state<EmaktabReminder[]>([]);

  onMount(async () => {
    try {
      reminders = (await api.emaktabReminders()).reminders;
    } catch {
      // A reminder is a courtesy: the page stands without it.
    }
  });
</script>

{#if reminders.length > 0}
  <div class="reminder">
    <Notice kind="warn">
      <b>{t('emaktab.reminder')}</b>
      <ul data-emaktab-reminders>
        {#each reminders.slice(0, 5) as r, i (i)}
          <li>
            <a href={`/teacher/journal/${r.classId}`}>{r.className}</a> ·
            {registerDate(r.date).slice(0, 5)}
            {r.lessonTitle} — {t('emaktab.hoursLeft', { count: r.hoursLeft })}
          </li>
        {/each}
      </ul>
    </Notice>
  </div>
{/if}

<style>
  .reminder {
    margin-bottom: var(--space-3);
  }
  ul {
    margin: var(--space-1) 0 0;
    padding-left: var(--space-4);
  }
</style>
