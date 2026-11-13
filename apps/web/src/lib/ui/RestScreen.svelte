<script lang="ts">
  import { t } from '../i18n/index.svelte.js';

  /** Shown on student screens during the rest part of the practice stage (STAGE1 S1.8). */
</script>

<div class="rest" role="status">
  <div class="eyes" aria-hidden="true">
    <svg viewBox="0 0 240 120">
      <path
        d="M20 60 Q60 20 100 60 Q60 100 20 60 Z M140 60 Q180 20 220 60 Q180 100 140 60 Z"
        fill="#fff"
        stroke="#13233a"
        stroke-width="6"
        stroke-linejoin="round"
      />
      <path
        d="M20 60 Q60 78 100 60 M140 60 Q180 78 220 60"
        fill="none"
        stroke="#13233a"
        stroke-width="8"
        stroke-linecap="round"
      />
    </svg>
  </div>
  <h1>{t('rest.title')}</h1>
  <p>{t('rest.hint')}</p>
</div>

<style>
  .rest {
    position: absolute;
    inset: 0;
    z-index: 50;
    background: #ede3ff;
    color: #3a1d6e;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    padding: var(--space-5);
    text-align: center;
  }
  .eyes svg {
    width: min(50vw, 320px);
    height: auto;
  }
  h1 {
    font-size: clamp(32px, 6vw, 64px);
    color: #3a1d6e;
    margin: 0;
  }
  p {
    font-size: clamp(18px, 2.5vw, 28px);
    margin: 0;
  }
</style>
