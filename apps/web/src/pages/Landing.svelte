<script lang="ts">
  import { t } from '../lib/i18n/index.svelte.js';
  import Button from '../lib/ui/Button.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import LangSwitch from '../lib/ui/LangSwitch.svelte';
  import PanelMock from './landing/PanelMock.svelte';
  import PilotForm from './landing/PilotForm.svelte';

  /**
   * The platform's landing page (PLAN.md 8.4; stage 6, B10; ADR-026): what Sinf is, how a lesson
   * goes, what works in a browser and in the classroom, the plans and the pilot request. Every claim
   * comes from CLAUDE.md; no prices until the author names them, no numbers nobody has measured.
   */
  const features = ['lessons', 'practice', 'kiosk', 'control', 'journal'] as const;
  const featureIcons = {
    lessons: 'play',
    practice: 'check',
    kiosk: 'lock',
    control: 'screen',
    journal: 'star',
  } as const;
  const steps = [
    { key: 'theory', minutes: 10 },
    { key: 'practice', minutes: 25 },
    { key: 'quiz', minutes: 7 },
    { key: 'summary', minutes: 3 },
  ] as const;
  /** "yes", "no", or a key for a short honest note (CLAUDE.md §4.11). */
  const modes: { key: string; web: string; app: string }[] = [
    { key: 'slides', web: 'yes', app: 'yes' },
    { key: 'lock', web: 'landing.modes.lock.web', app: 'landing.modes.lock.app' },
    { key: 'screens', web: 'no', app: 'yes' },
    { key: 'practice', web: 'landing.modes.practice.web', app: 'landing.modes.practice.app' },
    { key: 'files', web: 'landing.modes.files.web', app: 'yes' },
    { key: 'journal', web: 'yes', app: 'yes' },
  ];
  const teacherPlan = ['web', 'builder', 'journal', 'class'] as const;
  const schoolPlan = ['app', 'practice', 'control', 'school'] as const;
  const faq = ['internet', 'pcs', 'emaktab', 'data', 'price', 'languages'] as const;
</script>

<div class="landing">
  <header class="top">
    <div class="wrap row">
      <a class="brand" href="/" aria-label={t('app.name')}>
        <img src="/favicon.svg" alt="" width="28" height="28" />
        <span>{t('app.name')}</span>
      </a>
      <nav class="anchors" aria-label={t('landing.nav.label')}>
        <a href="#features">{t('landing.nav.features')}</a>
        <a href="#lesson">{t('landing.nav.lesson')}</a>
        <a href="#pricing">{t('landing.nav.pricing')}</a>
        <a href="#faq">{t('landing.nav.faq')}</a>
      </nav>
      <div class="actions">
        <span class="lang-full"><LangSwitch /></span>
        <span class="lang-short"><LangSwitch compact /></span>
        <Button href="/teacher/login" variant="ghost" size="sm">{t('landing.nav.login')}</Button>
        <Button href="/join" variant="secondary" size="sm">{t('home.student')}</Button>
      </div>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="wrap hero-grid">
        <div class="pitch">
          <h1>{t('landing.hero.title')}</h1>
          <p class="lead">{t('landing.hero.lead')}</p>
          <div class="cta">
            <Button href="/teacher/register" size="lg" data-cta="register"
              >{t('landing.hero.start')}</Button
            >
            <Button href="#pilot" size="lg" variant="secondary" data-cta="pilot"
              >{t('landing.hero.pilot')}</Button
            >
          </div>
          <p class="note">{t('landing.hero.note')}</p>
        </div>
        <PanelMock />
      </div>
    </section>

    <section id="features" class="section">
      <div class="wrap">
        <h2>{t('landing.features.title')}</h2>
        <div class="cards">
          {#each features as f (f)}
            <article class="card" data-feature={f}>
              <span class="badge"><Icon name={featureIcons[f]} size={20} /></span>
              <h3>{t(`landing.features.${f}.title`)}</h3>
              <p>{t(`landing.features.${f}.text`)}</p>
            </article>
          {/each}
        </div>
      </div>
    </section>

    <section id="lesson" class="section alt">
      <div class="wrap">
        <h2>{t('landing.lesson.title')}</h2>
        <p class="lead narrow">{t('landing.lesson.lead')}</p>
        <ol class="steps">
          {#each steps as s, i (s.key)}
            <li class="step">
              <span class="num">{i + 1}</span>
              <div>
                <h3>
                  {t(`landing.lesson.${s.key}`)}
                  <span class="minutes">{t('landing.lesson.minutes', { count: s.minutes })}</span>
                </h3>
                <p>{t(`landing.lesson.${s.key}.text`)}</p>
              </div>
            </li>
          {/each}
        </ol>
      </div>
    </section>

    <section id="modes" class="section">
      <div class="wrap">
        <h2>{t('landing.modes.title')}</h2>
        <p class="lead narrow">{t('landing.modes.lead')}</p>
        <div class="table-wrap">
          <table class="modes">
            <thead>
              <tr>
                <th scope="col"><span class="sr">{t('landing.modes.col.feature')}</span></th>
                <th scope="col">{t('landing.modes.col.web')}</th>
                <th scope="col">{t('landing.modes.col.app')}</th>
              </tr>
            </thead>
            <tbody>
              {#each modes as m (m.key)}
                <tr>
                  <th scope="row">{t(`landing.modes.${m.key}`)}</th>
                  {#each [m.web, m.app] as cell, i (i)}
                    <td data-label={t(i === 0 ? 'landing.modes.col.web' : 'landing.modes.col.app')}>
                      {#if cell === 'yes'}
                        <span class="yes"><Icon name="check" size={18} /></span>
                        <span class="sr">{t('landing.modes.yes')}</span>
                      {:else if cell === 'no'}
                        <span class="no" aria-hidden="true">—</span>
                        <span class="sr">{t('landing.modes.no')}</span>
                      {:else}
                        {t(cell)}
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section id="pricing" class="section alt">
      <div class="wrap">
        <h2>{t('landing.pricing.title')}</h2>
        <div class="plans">
          <article class="plan">
            <h3>{t('landing.pricing.teacher.title')}</h3>
            <p class="price">{t('landing.pricing.teacher.price')}</p>
            <ul>
              {#each teacherPlan as item (item)}
                <li><Icon name="check" size={18} />{t(`landing.pricing.teacher.${item}`)}</li>
              {/each}
            </ul>
            <Button href="/teacher/register" variant="secondary" block
              >{t('landing.hero.start')}</Button
            >
          </article>
          <article class="plan featured">
            <h3>{t('landing.pricing.school.title')}</h3>
            <p class="price">{t('landing.pricing.school.price')}</p>
            <p class="muted">{t('landing.pricing.school.note')}</p>
            <ul>
              {#each schoolPlan as item (item)}
                <li><Icon name="check" size={18} />{t(`landing.pricing.school.${item}`)}</li>
              {/each}
            </ul>
            <Button href="#pilot" block>{t('landing.hero.pilot')}</Button>
          </article>
        </div>
        <p class="pilot-note">{t('landing.pricing.pilot')}</p>
      </div>
    </section>

    <section id="pilot" class="section">
      <div class="wrap pilot">
        <div>
          <h2>{t('pilot.title')}</h2>
          <p class="lead">{t('pilot.lead')}</p>
        </div>
        <div class="form-card"><PilotForm /></div>
      </div>
    </section>

    <section id="faq" class="section alt">
      <div class="wrap">
        <h2>{t('landing.faq.title')}</h2>
        <div class="faq">
          {#each faq as q (q)}
            <details>
              <summary>{t(`landing.faq.${q}.q`)}</summary>
              <p>{t(`landing.faq.${q}.a`)}</p>
            </details>
          {/each}
        </div>
      </div>
    </section>
  </main>

  <footer class="foot">
    <div class="wrap row">
      <p class="muted">{t('landing.footer.note')}</p>
      <nav class="links" aria-label={t('landing.footer.label')}>
        <a href="/teacher/login">{t('landing.footer.login')}</a>
        <a href="/teacher/register">{t('landing.footer.register')}</a>
        <a href="/join">{t('home.student')}</a>
        <a href="/my">{t('home.myFiles')}</a>
      </nav>
    </div>
  </footer>
</div>

<style>
  .landing {
    background: var(--c-bg);
    color: var(--c-text);
  }
  .wrap {
    width: min(100% - 2 * var(--space-4), var(--page-max));
    margin-inline: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  /* ---------- header */
  .top {
    position: sticky;
    top: 0;
    z-index: 10;
    background: color-mix(in srgb, var(--c-bg) 92%, transparent);
    border-bottom: 1px solid var(--c-line);
    backdrop-filter: blur(6px);
  }
  .top .row {
    min-height: 64px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-lg);
    font-weight: 800;
    color: var(--c-dark);
    text-decoration: none;
  }
  .anchors {
    display: flex;
    gap: var(--space-4);
    margin-left: var(--space-4);
  }
  .anchors a {
    color: var(--c-text);
    text-decoration: none;
    font-weight: 600;
    font-size: var(--text-sm);
  }
  .anchors a:hover {
    color: var(--c-accent);
  }
  .actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .lang-short {
    display: none;
  }

  /* ---------- hero */
  .hero {
    padding: var(--space-8) 0 var(--space-7);
  }
  .hero-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
    gap: var(--space-7);
    align-items: center;
  }
  h1 {
    font-size: var(--text-3xl);
    line-height: var(--leading-tight);
    margin-bottom: var(--space-4);
  }
  .lead {
    font-size: var(--text-lg);
    color: var(--c-text);
  }
  .lead.narrow {
    max-width: var(--page-mid);
    margin-bottom: var(--space-5);
  }
  .cta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: var(--space-5) 0 var(--space-3);
  }
  .note {
    font-size: var(--text-sm);
    color: var(--c-muted);
  }

  /* ---------- sections */
  .section {
    padding: var(--space-8) 0;
    /* An anchor lands below the sticky header, not under it. */
    scroll-margin-top: 64px;
  }
  .section.alt {
    background: var(--c-surface);
    border-block: 1px solid var(--c-line);
  }
  .section h2 {
    font-size: var(--text-2xl);
    margin: 0 0 var(--space-4);
  }
  /* Five cards: three and two on a wide screen, the second row stretching instead of one orphan. */
  .cards {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin-top: var(--space-5);
  }
  .card {
    flex: 1 1 300px;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
  }
  .card h3 {
    margin: var(--space-3) 0 var(--space-2);
    font-size: var(--text-lg);
  }
  .badge {
    display: inline-flex;
    padding: var(--space-2);
    border-radius: var(--radius);
    background: var(--c-accent-soft);
    color: var(--c-accent);
  }

  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-4);
  }
  .step {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    background: var(--c-bg);
    border: 1px solid var(--c-line);
  }
  .step h3 {
    margin: 0 0 var(--space-1);
  }
  .step p {
    font-size: var(--text-sm);
  }
  .num {
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--c-dark);
    color: #fff;
    font-weight: 700;
  }
  .minutes {
    display: block;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--c-info);
  }

  .table-wrap {
    position: relative;
    overflow-x: auto;
    border: 1px solid var(--c-line);
    border-radius: var(--radius-lg);
    background: var(--c-surface);
  }
  .modes {
    width: 100%;
    border-collapse: collapse;
    min-width: 560px;
  }
  .modes th,
  .modes td {
    text-align: left;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--c-line);
    vertical-align: top;
  }
  .modes tbody tr:last-child th,
  .modes tbody tr:last-child td {
    border-bottom: 0;
  }
  .modes thead th {
    background: var(--c-bg-2);
    color: var(--c-dark);
    font-size: var(--text-sm);
  }
  .modes tbody th {
    color: var(--c-dark);
    font-weight: 600;
  }
  .modes td {
    font-size: var(--text-sm);
  }
  .yes {
    color: var(--c-ok);
    display: inline-flex;
  }
  .no {
    color: var(--c-muted);
  }

  .plans {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
    margin-top: var(--space-5);
  }
  .plan {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    border: 1px solid var(--c-line);
    background: var(--c-bg);
  }
  .plan.featured {
    border-color: var(--c-accent);
    box-shadow: var(--shadow);
  }
  .plan h3 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .price {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 800;
    color: var(--c-dark);
  }
  .plan ul {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: 0;
    display: grid;
    gap: var(--space-2);
    flex: 1;
  }
  .plan li {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
  }
  .plan li :global(.icon) {
    color: var(--c-ok);
    margin-top: 3px;
  }
  .muted {
    color: var(--c-muted);
  }
  .pilot-note {
    margin-top: var(--space-4);
    color: var(--c-muted);
  }

  .pilot {
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
    gap: var(--space-7);
    align-items: start;
  }
  .form-card {
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    padding: var(--space-6);
  }

  .faq {
    display: grid;
    gap: var(--space-2);
    max-width: var(--page-mid);
  }
  details {
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: var(--c-bg);
    padding: var(--space-3) var(--space-4);
  }
  summary {
    cursor: pointer;
    font-weight: 700;
    color: var(--c-dark);
  }
  details p {
    margin: var(--space-2) 0 0;
  }

  .foot {
    padding: var(--space-6) 0;
  }
  .foot .row {
    flex-wrap: wrap;
    justify-content: space-between;
  }
  .foot p {
    margin: 0;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  /* ---------- narrow screens */
  @media (max-width: 980px) {
    .anchors {
      display: none;
    }
    .hero-grid,
    .pilot {
      grid-template-columns: minmax(0, 1fr);
    }
    .steps {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 640px) {
    h1 {
      font-size: var(--text-2xl);
    }
    .hero {
      padding-top: var(--space-6);
    }
    .section {
      padding: var(--space-7) 0;
    }
    .steps,
    .plans {
      grid-template-columns: minmax(0, 1fr);
    }
    .actions :global(.btn.secondary),
    .lang-full {
      display: none;
    }
    .lang-short {
      display: block;
    }
    .top .row {
      gap: var(--space-2);
    }
    .plan,
    .form-card {
      padding: var(--space-5);
    }
    /* The table becomes one card per row: what, then the browser and the classroom, labelled. */
    .modes {
      min-width: 0;
    }
    .modes thead {
      display: none;
    }
    .modes,
    .modes tbody,
    .modes tr,
    .modes th,
    .modes td {
      display: block;
    }
    .modes tr {
      border-bottom: 1px solid var(--c-line);
      padding: var(--space-3) var(--space-4);
    }
    .modes tbody tr:last-child {
      border-bottom: 0;
    }
    .modes th,
    .modes td {
      padding: 0;
      border: 0;
    }
    .modes th {
      margin-bottom: var(--space-1);
    }
    .modes td {
      display: grid;
      grid-template-columns: 150px minmax(0, 1fr);
      gap: var(--space-2);
      align-items: baseline;
    }
    .modes td::before {
      content: attr(data-label) ':';
      color: var(--c-muted);
    }
  }
</style>
