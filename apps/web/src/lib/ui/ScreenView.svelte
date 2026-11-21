<script lang="ts">
  import { parseFrame, type DemoState } from '@sinf/shared';
  import { onMount } from 'svelte';
  import type { SessionStore } from '../stores/session.svelte.js';

  /**
   * A screen broadcast as it arrives (H14, ADR-017): the changed parts of the picture, each a JPEG,
   * drawn onto one canvas in the order they came. A viewer starts at a whole picture; frames of an
   * earlier broadcast (another epoch) are not drawn. The cursor is drawn apart, so moving it changes
   * nothing in the picture.
   */
  let { store, demo }: { store: SessionStore; demo: DemoState } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let box = $state<HTMLDivElement | null>(null);
  let size = $state<{ w: number; h: number } | null>(null);
  /** The picture fitted into the space it has, keeping its proportions. */
  let fit = $state<{ w: number; h: number }>({ w: 0, h: 0 });
  let space = $state<{ w: number; h: number }>({ w: 0, h: 0 });
  $effect(() => {
    if (!size || !space.w || !space.h) return;
    const scale = Math.min(space.w / size.w, space.h / size.h);
    fit = { w: Math.floor(size.w * scale), h: Math.floor(size.h * scale) };
  });
  let cursor = $state<{ x: number; y: number } | null>(null);
  let started = false;
  /** Frames are decoded one after another: a later frame must never be drawn under an earlier one. */
  let queue: Promise<void> = Promise.resolve();

  async function draw(bytes: Uint8Array): Promise<void> {
    const frame = parseFrame(bytes);
    if (!frame || frame.epoch !== demo.epoch || !canvas) return;
    if (!started && !frame.keyframe) return;
    const pictures = await Promise.all(
      frame.rects.map((r) =>
        createImageBitmap(
          new Blob([bytes.slice(r.offset, r.offset + r.length)], { type: 'image/jpeg' }),
        ),
      ),
    );
    // The broadcast may have changed while the pictures were being decoded.
    if (frame.epoch !== demo.epoch || !canvas) {
      for (const p of pictures) p.close();
      return;
    }
    if (canvas.width !== frame.width || canvas.height !== frame.height) {
      canvas.width = frame.width;
      canvas.height = frame.height;
      size = { w: frame.width, h: frame.height };
    }
    const ctx = canvas.getContext('2d');
    frame.rects.forEach((r, i) => {
      const p = pictures[i];
      if (!p) return;
      ctx?.drawImage(p, r.x, r.y, r.w, r.h);
      p.close();
    });
    started = true;
    cursor = frame.cursor;
  }

  onMount(() => {
    const stop = store.onFrame((bytes) => {
      queue = queue.then(() => draw(bytes)).catch(() => undefined);
    });
    const observer = new ResizeObserver(([entry]) => {
      if (entry) space = { w: entry.contentRect.width, h: entry.contentRect.height };
    });
    if (box) observer.observe(box);
    return () => {
      stop();
      observer.disconnect();
    };
  });
</script>

<div class="screen" class:waiting={!size} bind:this={box}>
  <div class="pic" style:width="{fit.w}px" style:height="{fit.h}px">
    <canvas bind:this={canvas} aria-label="screen"></canvas>
    {#if cursor && size}
      <span
        class="cursor"
        style:left="{(100 * cursor.x) / size.w}%"
        style:top="{(100 * cursor.y) / size.h}%"
      ></span>
    {/if}
  </div>
</div>

<style>
  .screen {
    position: relative;
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    background: #111;
    overflow: hidden;
  }
  .pic {
    position: relative;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .waiting canvas {
    visibility: hidden;
  }
  .cursor {
    position: absolute;
    width: 14px;
    height: 14px;
    margin: -2px 0 0 -2px;
    border-left: 3px solid #fff;
    border-top: 3px solid #fff;
    box-shadow: -1px -1px 0 #000;
    transform: rotate(-12deg);
    pointer-events: none;
  }
</style>
