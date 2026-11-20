/**
 * Tests resolve workspace packages to their TypeScript sources (the `@sinf/source` export condition),
 * so `pnpm test` works without building `dist` first.
 */
// Vite adds `import` / `require` / `default` itself depending on how a module is loaded; listing them here would
// make CommonJS `require('ws')` pick the ESM wrapper. These are Vite's server defaults plus our source condition.
const conditions = ['@sinf/source', 'module', 'node', 'development|production'];

export const sourceConditions = {
  resolve: { conditions },
  ssr: { resolve: { conditions } },
};
