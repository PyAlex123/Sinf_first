import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defaultClientConditions, defineConfig } from 'vite';

const SERVER = process.env['SINF_SERVER_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    // Workspace packages resolve to their TypeScript sources in dev and build. The list replaces Vite's
    // defaults, so they are added back (without `browser` Svelte would load its server build).
    conditions: ['@sinf/source', ...defaultClientConditions],
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': SERVER,
      '/content': SERVER,
      '/health': SERVER,
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    manifest: true,
    sourcemap: false,
    target: 'es2022',
    // Low-end school PCs (CLAUDE.md §3.1): keep the initial bundle small; pages load on demand.
    chunkSizeWarningLimit: 250,
  },
});
