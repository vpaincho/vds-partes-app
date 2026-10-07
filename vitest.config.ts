import { defineConfig } from 'vitest/config';

/**
 * Default suite: domain, rules and UI. No external dependency, so it runs anywhere and fast.
 * Database tests live in vitest.db.config.ts because they need a real PostgreSQL — see
 * `npm run test:db`. `npm run verify` runs both.
 */
export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/db/**'],
    environment: 'node',
    reporters: ['default'],
  },
});
