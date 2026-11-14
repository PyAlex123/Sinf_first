<script lang="ts">
  import qrcode from 'qrcode-generator';

  /** QR code as inline SVG (no canvas, no network). Error correction M is enough for a short URL. */
  let { value, size = 240 }: { value: string; size?: number } = $props();

  const svg = $derived.by(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 1, scalable: true });
  });
</script>

<div class="qr" style="width:{size}px;height:{size}px" role="img" aria-label={value}>
  {@html svg}
</div>

<style>
  .qr {
    background: #fff;
    border-radius: var(--radius);
    padding: 6px;
  }
  .qr :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
