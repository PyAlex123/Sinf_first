import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineProject } from 'vitest/config';
import { sourceConditions } from '../../vitest.shared.js';

export default defineProject({
  ...sourceConditions,
  plugins: [svelte()],
  test: {
    name: 'web',
    include: ['test/**/*.test.ts'],
  },
});
