<script lang="ts">
  import type { Screen } from '@sinf/shared';

  let { screen }: { screen: Extract<Screen, { kind: 'slide' | 'step' }> } = $props();
  const cls = $derived(screen.kind === 'step' ? 'step' : screen.layout);
</script>

<!-- Slide HTML comes from the import, sanitized (ADR-005); pictures are lazy-loaded /content URLs. -->
<section class="slide {cls}">{@html screen.html}</section>
