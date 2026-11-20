import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defaultClientConditions, defineConfig } from 'vite';

/**
 * Standalone build of the lesson player for a shareable demo page (no server, no API).
 * Everything is loaded from files next to the page, so relative paths are required.
 */
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ['@sinf/source', ...defaultClientConditions],
  },
  base: './',
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: resolve(import.meta.dirname, 'demo.html'),
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
