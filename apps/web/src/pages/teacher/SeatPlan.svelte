<script lang="ts">
  import type { Seat, Student } from '@sinf/shared';
  import { onMount } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import Card from '../../lib/ui/Card.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Notice from '../../lib/ui/Notice.svelte';

  /**
   * Seating of the class on the classroom's teacher computer (stage 3, H8): which child sits at
   * which computer, so the next lesson greets them by name. The teacher drags a name onto another
   * computer (the two swap) or picks the child from the list under a computer. Not shown where there
   * is no room — the platform or a teacher's browser at home (the server answers 404).
   */

  let { classId, students }: { classId: string; students: Student[] } = $props();

  let seats = $state<Seat[] | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let dragged = $state<string | null>(null);
  let over = $state<string | null>(null);

  const active = $derived(students.filter((s) => s.isActive));
  const nameOf = (id: string | null): string | null => {
    const s = id ? students.find((x) => x.id === id) : undefined;
    return s ? `${s.lastName} ${s.firstName}` : null;
  };

  onMount(() => {
    void (async () => {
      try {
        seats = (await api.seatPlan(classId)).seats;
      } catch (e) {
        // 404: no room here. Anything else: the section stays away rather than nag.
        if (!(e instanceof ApiError && e.status === 404)) error = t('common.error');
      }
    })();
  });

  async function move(pc: string, studentId: string | null): Promise<void> {
    if (busy) return;
    busy = true;
    error = null;
    try {
      seats = (await api.moveSeat(classId, pc, studentId)).seats;
    } catch {
      error = t('common.error');
    } finally {
      busy = false;
    }
  }

  function drop(event: DragEvent, pc: string): void {
    event.preventDefault();
    over = null;
    const id = dragged ?? event.dataTransfer?.getData('text/plain') ?? null;
    dragged = null;
    if (id) void move(pc, id);
  }
</script>

{#if seats || error}
  <section class="stack" aria-labelledby="seats-title">
    <h2 id="seats-title">{t('seats.title')}</h2>
    <p class="muted small">{t('seats.hint')}</p>
    {#if error}<Notice kind="error">{error}</Notice>{/if}
    {#if seats && seats.length === 0}
      <Card><p class="muted">{t('seats.empty')}</p></Card>
    {:else if seats}
      <ul class="room" aria-busy={busy}>
        {#each seats as seat (seat.pc)}
          <li
            class="pc"
            class:over={over === seat.pc}
            class:free={!seat.studentId}
            data-pc={seat.pc}
            ondragover={(e) => {
              e.preventDefault();
              over = seat.pc;
            }}
            ondragleave={() => (over = over === seat.pc ? null : over)}
            ondrop={(e) => drop(e, seat.pc)}
          >
            <div class="pcname"><Icon name="pc" size={16} /> {seat.pc}</div>
            {#if seat.studentId}
              <div
                class="who"
                draggable="true"
                role="button"
                tabindex="-1"
                aria-label={t('seats.drag', { name: nameOf(seat.studentId) ?? '' })}
                ondragstart={(e) => {
                  dragged = seat.studentId;
                  e.dataTransfer?.setData('text/plain', seat.studentId ?? '');
                }}
                ondragend={() => {
                  dragged = null;
                  over = null;
                }}
              >
                {nameOf(seat.studentId) ?? t('seats.unknown')}
              </div>
            {:else}
              <div class="who none">{t('seats.free')}</div>
            {/if}
            <select
              aria-label={t('seats.pick', { pc: seat.pc })}
              value={seat.studentId ?? ''}
              disabled={busy}
              onchange={(e) => void move(seat.pc, e.currentTarget.value || null)}
            >
              <option value="">{t('seats.nobody')}</option>
              {#each active as s (s.id)}
                <option value={s.id}>{s.lastName} {s.firstName}</option>
              {/each}
            </select>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .room {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  }
  .pc {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-lg);
    background: var(--c-bg);
  }
  .pc.free {
    border-style: dashed;
  }
  .pc.over {
    border-color: var(--c-info);
    background: var(--c-info-soft);
  }
  .pcname {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--c-muted);
  }
  .who {
    font-weight: 600;
    padding: var(--space-2);
    border-radius: var(--radius);
    background: var(--c-bg-2);
    cursor: grab;
  }
  .who.none {
    font-weight: 400;
    color: var(--c-muted);
    background: none;
    cursor: default;
  }
  select {
    font: inherit;
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius);
    background: var(--c-bg);
  }
</style>
