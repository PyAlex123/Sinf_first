/**
 * Tests resolve workspace packages to their TypeScript sources (the `@sinf/source` export condition),
 * so `pnpm test` works without building `dist` first.
 */
const conditions = ['@sinf/source', 'module', 'node', 'import', 'default'];

export const sourceConditions = {
  resolve: { conditions },
  ssr: { resolve: { conditions } },
};
