import { defineConfig } from 'drizzle-kit';

/** `pnpm --filter @sinf/server db:generate` writes SQL migrations to ./drizzle (committed). */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
