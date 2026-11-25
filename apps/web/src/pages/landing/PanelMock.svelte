<script lang="ts">
  import { t } from '../../lib/i18n/index.svelte.js';
  import Icon from '../../lib/ui/Icon.svelte';

  /**
   * The teacher's class panel during a practice, drawn in CSS for the landing page (B10): no
   * screenshot to keep up to date and nothing to download. Decorative — one label tells a screen
   * reader what it shows.
   */
  const tiles = [
    { n: 1, done: 5 },
    { n: 2, done: 4 },
    { n: 3, done: 2 },
    { n: 4, done: 5 },
    { n: 5, done: 3 },
    { n: 6, done: 1, hand: true },
    { n: 7, done: 4 },
    { n: 8, done: 5 },
  ];
  const TOTAL = 5;
</script>

<figure class="mock" role="img" aria-label={t('landing.mock.caption')}>
  <div class="bar" aria-hidden="true">
    <span class="stage">{t('landing.mock.stage')}</span>
    <span class="timer"><Icon name="clock" size={16} /> 18:42</span>
    <span class="attention"><Icon name="lock" size={16} /> {t('landing.mock.attention')}</span>
  </div>
  <div class="tiles" aria-hidden="true">
    {#each tiles as tile (tile.n)}
      <div class="tile">
        <div class="screen">
          <span class="line wide"></span>
          <span class="line"></span>
          <span class="line short"></span>
        </div>
        <div class="meta">
          <span class="pc">{t('landing.mock.pc', { n: tile.n })}</span>
          {#if tile.hand}<span class="hand"><Icon name="hand" size={14} /></span>{/if}
          <span class="score" class:full={tile.done === TOTAL} class:low={tile.done <= 2}
            >{tile.done}/{TOTAL}</span
          >
        </div>
      </div>
    {/each}
  </div>
  <figcaption>{t('landing.mock.caption')}</figcaption>
</figure>

<style>
  .mock {
    margin: 0;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    padding: var(--space-4);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .stage {
    white-space: nowrap;
    background: var(--c-info-soft);
    color: var(--c-info);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
  }
  .timer {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--c-dark);
    font-variant-numeric: tabular-nums;
  }
  .attention {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    background: var(--c-accent);
    color: #fff;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .tile {
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    padding: var(--space-2);
    background: var(--c-bg);
  }
  .screen {
    aspect-ratio: 16 / 10;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .line {
    height: 5px;
    border-radius: 3px;
    background: var(--c-line-strong);
    width: 70%;
  }
  .line.wide {
    width: 90%;
    background: var(--c-dark);
    opacity: 0.6;
  }
  .line.short {
    width: 45%;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-2);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--c-dark);
  }
  .hand {
    color: var(--c-star-ink);
  }
  .score {
    margin-left: auto;
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--c-bg-2);
    color: var(--c-text);
    font-variant-numeric: tabular-nums;
  }
  .score.full {
    background: var(--c-ok-soft);
    color: var(--c-ok);
  }
  .score.low {
    background: var(--c-danger-soft);
    color: var(--c-danger);
  }
  figcaption {
    margin-top: var(--space-3);
    font-size: var(--text-sm);
    color: var(--c-muted);
    text-align: center;
  }
  @media (max-width: 520px) {
    .tiles {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .tile:nth-child(n + 5) {
      display: none;
    }
  }
</style>
